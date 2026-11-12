package expo.modules.pebblebond

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.Locale

private const val ACTION_BOND_STATE_CHANGED = BluetoothDevice.ACTION_BOND_STATE_CHANGED
private const val MAX_WAITERS = 8

class PebbleBondModule : Module() {
  private data class Waiter(
    val requestId: String,
    val address: String,
    val device: BluetoothDevice,
    val promise: Promise,
    val registrationContext: Context,
    var receiver: BroadcastReceiver? = null,
    var receiverRegistered: Boolean = false,
    var timeout: Runnable? = null,
    var settled: Boolean = false,
    var initiated: Boolean = false,
    var observedBonding: Boolean = false,
  )

  private val mainHandler = Handler(Looper.getMainLooper())
  private val waiters = mutableMapOf<String, Waiter>()
  @Volatile private var destroyed = false

  override fun definition() = ModuleDefinition {
    Name("PebbleBond")

    AsyncFunction("getState") { nativeId: String ->
      try {
        val device = getExistingDevice(nativeId) ?: return@AsyncFunction "unsupported"
        stateName(device.bondState)
      } catch (error: SecurityException) {
        throw IllegalStateException("PEBBLE_PAIRING_PERMISSION", error)
      }
    }

    AsyncFunction("ensureBonded") { nativeId: String, requestId: String, timeoutMs: Double, promise: Promise ->
      if (destroyed) {
        promise.reject("PEBBLE_PAIRING_CANCELLED", "Bond wait cancelled", null)
      } else {
        mainHandler.post {
          if (destroyed) promise.reject("PEBBLE_PAIRING_CANCELLED", "Bond wait cancelled", null)
          else startBondWait(nativeId, requestId, timeoutMs, promise)
        }
      }
    }

    AsyncFunction("cancelWait") { requestId: String, promise: Promise ->
      mainHandler.post {
        waiters[requestId]?.let { settle(it, "PEBBLE_PAIRING_CANCELLED", "Bond wait cancelled") }
        promise.resolve(null)
      }
    }

    OnDestroy {
      // Fence new work synchronously, then drain all existing waiters on their
      // serialized lifecycle lane. Queued starts observe the fence and allocate none.
      destroyed = true
      mainHandler.post {
        waiters.values.toList().forEach {
          settle(it, "PEBBLE_PAIRING_CANCELLED", "Bond wait cancelled")
        }
      }
    }
  }

  private fun startBondWait(nativeId: String, requestId: String, timeoutMs: Double, promise: Promise) {
    if (destroyed) return promise.reject("PEBBLE_PAIRING_CANCELLED", "Bond wait cancelled", null)
    if (requestId.isBlank()) return promise.reject("PEBBLE_PAIRING_INVALID_REQUEST", "Request id is required", null)
    val device = try {
      getExistingDevice(nativeId)
    } catch (error: SecurityException) {
      return promise.reject("PEBBLE_PAIRING_PERMISSION", "Bluetooth connect permission is required", error)
    } catch (error: IllegalArgumentException) {
      return promise.reject("PEBBLE_PAIRING_INVALID_DEVICE", "Invalid Bluetooth device id", error)
    } catch (error: Exception) {
      return promise.reject("PEBBLE_PAIRING_UNSUPPORTED", "Bluetooth is unavailable", error)
    } ?: return promise.reject("PEBBLE_PAIRING_UNSUPPORTED", "Bluetooth is unavailable", null)

    try {
      when (device.bondState) {
        BluetoothDevice.BOND_BONDED -> return promise.resolve(null)
        BluetoothDevice.BOND_BONDING -> Unit
        BluetoothDevice.BOND_NONE -> Unit
        else -> return promise.reject("PEBBLE_PAIRING_UNSUPPORTED", "Bluetooth bond state is unavailable", null)
      }
      val timeout = safeTimeout(timeoutMs)
      val context = appContext.reactContext
        ?: return promise.reject("PEBBLE_PAIRING_UNAVAILABLE", "Application context is unavailable", null)
      val waiter = Waiter(requestId, device.address.uppercase(Locale.ROOT), device, promise, context)
      if (waiters.size >= MAX_WAITERS) return promise.reject("PEBBLE_PAIRING_BUSY", "Too many bond waits", null)
      if (waiters.containsKey(requestId) || waiters.values.any { it.address == waiter.address }) {
        return promise.reject("PEBBLE_PAIRING_BUSY", "A bond wait is already active", null)
      }
      // From insertion through receiver registration and initiation all operations
      // run in this single main-lane task, so cancellation/destruction cannot
      // settle a partial waiter and then allow registration to happen afterward.
      waiters[requestId] = waiter

      val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
          if (intent?.action != ACTION_BOND_STATE_CHANGED) return
          try {
            val eventDevice = if (Build.VERSION.SDK_INT >= 33) {
              intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
            } else {
              @Suppress("DEPRECATION")
              intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
            } ?: return
            mainHandler.post {
              if (!isActive(waiter)) return@post
              try {
                if (!eventDevice.address.equals(waiter.address, ignoreCase = true)) return@post
                // The broadcast only wakes us. Always query the real device state.
                checkAuthoritativeState(waiter, true)
              } catch (error: SecurityException) {
                settle(waiter, "PEBBLE_PAIRING_PERMISSION", "Bluetooth connect permission is required", error)
              }
            }
          } catch (error: SecurityException) {
            mainHandler.post {
              if (isActive(waiter)) {
                settle(waiter, "PEBBLE_PAIRING_PERMISSION", "Bluetooth connect permission is required", error)
              }
            }
          }
        }
      }
      waiter.receiver = receiver
      val filter = IntentFilter(ACTION_BOND_STATE_CHANGED)
      if (Build.VERSION.SDK_INT >= 33) {
        context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
      } else {
        @Suppress("DEPRECATION")
        context.registerReceiver(receiver, filter)
      }
      waiter.receiverRegistered = true
      waiter.timeout = Runnable {
        settle(waiter, "PEBBLE_PAIRING_TIMEOUT", "Timed out waiting for Bluetooth bonding")
      }
      mainHandler.postDelayed(waiter.timeout!!, timeout)

      // Close the race between initial state lookup and receiver registration.
      checkAuthoritativeState(waiter)
      if (isActive(waiter) && device.bondState == BluetoothDevice.BOND_NONE) {
        waiter.initiated = true
        val started = device.createBond()
        if (!started) settle(waiter, "PEBBLE_PAIRING_FAILED", "Bluetooth bonding could not be started")
        else checkAuthoritativeState(waiter)
      }
    } catch (error: SecurityException) {
      val waiter = waiters[requestId]
      if (waiter != null) settle(waiter, "PEBBLE_PAIRING_PERMISSION", "Bluetooth connect permission is required", error)
      else promise.reject("PEBBLE_PAIRING_PERMISSION", "Bluetooth connect permission is required", error)
    } catch (error: Exception) {
      val waiter = waiters[requestId]
      if (waiter != null) settle(waiter, "PEBBLE_PAIRING_FAILED", "Bluetooth bonding failed", error)
      else promise.reject("PEBBLE_PAIRING_FAILED", "Bluetooth bonding failed", error)
    }
  }

  private fun checkAuthoritativeState(waiter: Waiter, bondEvent: Boolean = false) {
    if (!isActive(waiter)) return
    try {
      when (waiter.device.bondState) {
        BluetoothDevice.BOND_BONDED -> settle(waiter, null, null)
        BluetoothDevice.BOND_BONDING -> waiter.observedBonding = true
        BluetoothDevice.BOND_NONE -> if (waiter.initiated && bondEvent && waiter.observedBonding) {
          settle(waiter, "PEBBLE_PAIRING_FAILED", "Bluetooth bonding failed")
        }
        // BOND_NONE before createBond is a normal initial state, not failure.
        else -> Unit
      }
    } catch (error: SecurityException) {
      settle(waiter, "PEBBLE_PAIRING_PERMISSION", "Bluetooth connect permission is required", error)
    }
  }

  private fun getExistingDevice(nativeId: String): BluetoothDevice? {
    val context = appContext.reactContext ?: return null
    if (Build.VERSION.SDK_INT >= 31 &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED
    ) throw SecurityException("BLUETOOTH_CONNECT permission is required")
    val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
      ?: return null
    val adapter: BluetoothAdapter = manager.adapter ?: return null
    if (!adapter.isEnabled) return null
    return adapter.getRemoteDevice(nativeId)
  }

  private fun isActive(waiter: Waiter): Boolean =
    !waiter.settled && waiters[waiter.requestId] === waiter

  private fun settle(waiter: Waiter, code: String?, message: String?, cause: Throwable? = null) {
    if (waiter.settled) return
    waiter.settled = true
    waiters.remove(waiter.requestId)
    waiter.timeout?.let { mainHandler.removeCallbacks(it) }
    if (waiter.receiverRegistered) {
      waiter.receiver?.let { receiver ->
        try {
          waiter.registrationContext.unregisterReceiver(receiver)
        } catch (_: IllegalArgumentException) {
        } catch (_: SecurityException) {
        }
      }
      waiter.receiverRegistered = false
    }
    if (code == null) waiter.promise.resolve(null)
    else waiter.promise.reject(code, message ?: code, cause)
  }

  private fun safeTimeout(timeoutMs: Double): Long = when {
    timeoutMs.isNaN() || timeoutMs == Double.NEGATIVE_INFINITY -> 1L
    timeoutMs == Double.POSITIVE_INFINITY -> 60_000L
    else -> timeoutMs.toLong().coerceIn(1L, 60_000L)
  }

  private fun stateName(state: Int): String = when (state) {
    BluetoothDevice.BOND_NONE -> "none"
    BluetoothDevice.BOND_BONDING -> "bonding"
    BluetoothDevice.BOND_BONDED -> "bonded"
    else -> "unsupported"
  }
}
