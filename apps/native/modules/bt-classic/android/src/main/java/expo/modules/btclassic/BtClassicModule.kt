package expo.modules.btclassic

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothServerSocket
import android.bluetooth.BluetoothSocket
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong

/**
 * Bluetooth Classic RFCOMM sockets for the direct-device stack
 * (docs/research/notes/Bluetooth Classic RFCOMM, decided 2026-11-13: Android
 * only). One reader thread and one ordered writer per socket; connects and
 * accepts run on a background executor with a watchdog. Server sockets
 * (`listen`/`accept`) serve Garmin Edge, which opens the link towards the
 * phone. Errors reject with BT_CLASSIC_* codes.
 */
class BtClassicModule : Module() {
  private class SocketEntry(val socket: BluetoothSocket) {
    val writer: ExecutorService = Executors.newSingleThreadExecutor()
    val closed = AtomicBoolean(false)
    @Volatile var reader: Thread? = null
  }

  private class ServerEntry(val server: BluetoothServerSocket) {
    val accepting = AtomicBoolean(false)
    val closed = AtomicBoolean(false)
  }

  private val sockets = ConcurrentHashMap<String, SocketEntry>()
  private val servers = ConcurrentHashMap<String, ServerEntry>()
  /** Servers open or opening; reserved on the caller thread, freed by closeServer. */
  private val serverSlots = AtomicInteger(0)
  /** ACTION_UUID receivers still waiting; unregistered on settle or destroy. */
  private val uuidReceivers = ConcurrentHashMap.newKeySet<BroadcastReceiver>()
  private val pendingConnects = ConcurrentHashMap<String, BluetoothSocket>()
  /** Addresses with a connect in flight; claimed on the caller thread. */
  private val connectingAddresses = ConcurrentHashMap.newKeySet<String>()
  private val discoveryGeneration = AtomicInteger(0)
  private val nextId = AtomicLong(1)
  private val connectExecutor: ExecutorService = Executors.newCachedThreadPool()
  private val destroyed = AtomicBoolean(false)
  @Volatile private var discoveryReceiver: BroadcastReceiver? = null

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("BT_CLASSIC_UNSUPPORTED")

  private fun adapter(): BluetoothAdapter? =
    (context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

  override fun definition() = ModuleDefinition {
    Name("BtClassic")
    Events("onData", "onClosed", "onDiscovered", "onDiscoveryFinished")

    Function("isAvailable") { adapter() != null }

    AsyncFunction("getAdapterState") { ->
      val adapter = adapter() ?: return@AsyncFunction "unsupported"
      if (adapter.isEnabled) "on" else "off"
    }

    AsyncFunction("listBonded") { promise: Promise ->
      val adapter = usableAdapter(promise, Manifest.permission.BLUETOOTH_CONNECT) ?: return@AsyncFunction
      try {
        promise.resolve(adapter.bondedDevices.map { describe(it) })
      } catch (error: SecurityException) {
        promise.reject("BT_CLASSIC_PERMISSION", error.message, error)
      }
    }

    AsyncFunction("startDiscovery") { timeoutMs: Double, promise: Promise ->
      val adapter = usableAdapter(promise, Manifest.permission.BLUETOOTH_SCAN) ?: return@AsyncFunction
      // Before Android 12, Classic discovery results need location access.
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S &&
        context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) !=
        PackageManager.PERMISSION_GRANTED
      ) {
        promise.reject("BT_CLASSIC_PERMISSION", Manifest.permission.ACCESS_FINE_LOCATION, null)
        return@AsyncFunction
      }
      val generation = discoveryGeneration.incrementAndGet()
      try {
        stopDiscoveryReceiver()
        val receiver = object : BroadcastReceiver() {
          override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
              BluetoothDevice.ACTION_FOUND -> {
                val device = deviceExtra(intent) ?: return
                sendEvent("onDiscovered", describe(device))
              }
              BluetoothAdapter.ACTION_DISCOVERY_FINISHED -> {
                stopDiscoveryReceiver()
                sendEvent("onDiscoveryFinished", mapOf<String, Any?>())
              }
            }
          }
        }
        val filter = IntentFilter().apply {
          addAction(BluetoothDevice.ACTION_FOUND)
          addAction(BluetoothAdapter.ACTION_DISCOVERY_FINISHED)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        } else {
          @Suppress("UnspecifiedRegisterReceiverFlag")
          context.registerReceiver(receiver, filter)
        }
        discoveryReceiver = receiver
        if (!adapter.startDiscovery()) {
          stopDiscoveryReceiver()
          promise.reject("BT_CLASSIC_DISCOVERY_FAILED", "startDiscovery returned false", null)
          return@AsyncFunction
        }
        connectExecutor.execute {
          try {
            Thread.sleep(timeoutMs.toLong().coerceIn(1_000L, 60_000L))
          } catch (_: InterruptedException) {}
          // Only the discovery this timer belongs to.
          if (discoveryGeneration.get() == generation) {
            try {
              adapter.cancelDiscovery()
            } catch (_: SecurityException) {}
          }
        }
        promise.resolve(null)
      } catch (error: SecurityException) {
        stopDiscoveryReceiver()
        promise.reject("BT_CLASSIC_PERMISSION", error.message, error)
      }
    }

    AsyncFunction("cancelDiscovery") { ->
      try {
        adapter()?.cancelDiscovery()
      } catch (_: SecurityException) {}
      stopDiscoveryReceiver()
    }

    AsyncFunction("connect") { address: String, uuid: String, secure: Boolean, timeoutMs: Double, promise: Promise ->
      val adapter = usableAdapter(promise, Manifest.permission.BLUETOOTH_CONNECT) ?: return@AsyncFunction
      if (!BluetoothAdapter.checkBluetoothAddress(address)) {
        promise.reject("BT_CLASSIC_INVALID_ADDRESS", address, null)
        return@AsyncFunction
      }
      val serviceUuid = try {
        UUID.fromString(uuid)
      } catch (error: IllegalArgumentException) {
        promise.reject("BT_CLASSIC_INVALID_UUID", uuid, error)
        return@AsyncFunction
      }
      if (sockets.size >= MAX_SOCKETS) {
        promise.reject("BT_CLASSIC_TOO_MANY_SOCKETS", null, null)
        return@AsyncFunction
      }
      if (!connectingAddresses.add(address)) {
        promise.reject("BT_CLASSIC_BUSY", address, null)
        return@AsyncFunction
      }
      connectExecutor.execute {
        try {
          connectOnExecutor(adapter, address, serviceUuid, secure, timeoutMs, promise)
        } finally {
          connectingAddresses.remove(address)
        }
      }
    }

    // The reader starts only after JS has subscribed, so no early bytes are lost.
    AsyncFunction("startReading") { socketId: String, bufferSize: Int, promise: Promise ->
      val entry = sockets[socketId]
      if (entry == null || entry.closed.get()) {
        promise.reject("BT_CLASSIC_NOT_CONNECTED", socketId, null)
        return@AsyncFunction
      }
      if (entry.reader != null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      val size = bufferSize.coerceIn(64, 65_536)
      val reader = Thread {
        val buffer = ByteArray(size)
        var reason = "remote"
        var message: String? = null
        try {
          val input = entry.socket.inputStream
          while (!entry.closed.get()) {
            val count = input.read(buffer)
            if (count < 0) break
            // Base64 crosses the bridge as a plain string on every RN version.
            if (count > 0) {
              val encoded = Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP)
              sendEvent("onData", mapOf("socketId" to socketId, "base64" to encoded))
            }
          }
        } catch (error: Throwable) {
          // Anything escaping this thread would kill the process.
          reason = if (entry.closed.get()) "local" else "error"
          message = error.message
        }
        closeEntry(socketId, reason, message)
      }
      reader.isDaemon = true
      entry.reader = reader
      reader.start()
      promise.resolve(null)
    }

    AsyncFunction("write") { socketId: String, bytes: ByteArray, promise: Promise ->
      val entry = sockets[socketId]
      if (entry == null || entry.closed.get()) {
        promise.reject("BT_CLASSIC_NOT_CONNECTED", socketId, null)
        return@AsyncFunction
      }
      try {
        entry.writer.execute {
          try {
            val output = entry.socket.outputStream
            output.write(bytes)
            output.flush()
            promise.resolve(null)
          } catch (error: IOException) {
            promise.reject("BT_CLASSIC_WRITE_FAILED", error.message, error)
            closeEntry(socketId, "error", error.message)
          }
        }
      } catch (error: java.util.concurrent.RejectedExecutionException) {
        promise.reject("BT_CLASSIC_SOCKET_CLOSED", socketId, error)
      }
    }

    AsyncFunction("close") { socketId: String ->
      closeEntry(socketId, "local", null)
    }

    // A server socket with an SDP record; `accept` then waits for one link.
    AsyncFunction("listen") { name: String, uuid: String, secure: Boolean, promise: Promise ->
      val adapter = usableAdapter(promise, Manifest.permission.BLUETOOTH_CONNECT) ?: return@AsyncFunction
      val serviceUuid = try {
        UUID.fromString(uuid)
      } catch (error: IllegalArgumentException) {
        promise.reject("BT_CLASSIC_INVALID_UUID", uuid, error)
        return@AsyncFunction
      }
      // Reserve a slot before the executor runs, so concurrent listens cannot
      // exceed the cap; released when the server closes or listen fails.
      if (serverSlots.incrementAndGet() > MAX_SERVERS) {
        serverSlots.decrementAndGet()
        promise.reject("BT_CLASSIC_BUSY", null, null)
        return@AsyncFunction
      }
      try {
        connectExecutor.execute {
          val server = try {
            if (secure) adapter.listenUsingRfcommWithServiceRecord(name, serviceUuid)
            else adapter.listenUsingInsecureRfcommWithServiceRecord(name, serviceUuid)
          } catch (error: SecurityException) {
            serverSlots.decrementAndGet()
            promise.reject("BT_CLASSIC_PERMISSION", error.message, error)
            return@execute
          } catch (error: Throwable) {
            // Anything escaping a pool thread would kill the process.
            serverSlots.decrementAndGet()
            promise.reject("BT_CLASSIC_LISTEN_FAILED", error.message, error)
            return@execute
          }
          val id = "server-${nextId.getAndIncrement()}"
          servers[id] = ServerEntry(server)
          // OnDestroy may have swept the map before this entry landed.
          if (destroyed.get()) {
            closeServer(id)
            promise.reject("BT_CLASSIC_CANCELLED", null, null)
            return@execute
          }
          promise.resolve(id)
        }
      } catch (error: java.util.concurrent.RejectedExecutionException) {
        serverSlots.decrementAndGet()
        promise.reject("BT_CLASSIC_CANCELLED", null, error)
      }
    }

    // Waits for one inbound link, then closes the server socket. A watchdog
    // close() from another thread enforces timeoutMs, as for connect.
    AsyncFunction("accept") { serverId: String, timeoutMs: Double, promise: Promise ->
      val entry = servers[serverId]
      if (entry == null || entry.closed.get()) {
        promise.reject("BT_CLASSIC_NOT_LISTENING", serverId, null)
        return@AsyncFunction
      }
      if (sockets.size >= MAX_SOCKETS) {
        promise.reject("BT_CLASSIC_TOO_MANY_SOCKETS", null, null)
        return@AsyncFunction
      }
      if (!entry.accepting.compareAndSet(false, true)) {
        promise.reject("BT_CLASSIC_BUSY", serverId, null)
        return@AsyncFunction
      }
      connectExecutor.execute { acceptOnExecutor(serverId, entry, timeoutMs, promise) }
    }

    AsyncFunction("stopListening") { serverId: String ->
      closeServer(serverId)
    }

    // Starts an SDP query (fetchUuidsWithSdp) and resolves with the UUIDs the
    // ACTION_UUID broadcast reports, or the cached ones after timeoutMs. For
    // Garmin the query itself is the point: it makes the device connect back
    // (GarminRfcommListener.requestConnection).
    AsyncFunction("fetchUuids") { address: String, timeoutMs: Double, promise: Promise ->
      val adapter = usableAdapter(promise, Manifest.permission.BLUETOOTH_CONNECT) ?: return@AsyncFunction
      if (!BluetoothAdapter.checkBluetoothAddress(address)) {
        promise.reject("BT_CLASSIC_INVALID_ADDRESS", address, null)
        return@AsyncFunction
      }
      val device = adapter.getRemoteDevice(address)
      val settled = AtomicBoolean(false)
      val receiver = object : BroadcastReceiver() {
        // Runs on the main thread: nothing may escape it.
        override fun onReceive(context: Context, intent: Intent) {
          try {
            if (intent.action != BluetoothDevice.ACTION_UUID) return
            val found = deviceExtra(intent) ?: return
            if (!found.address.equals(address, ignoreCase = true)) return
            if (settled.compareAndSet(false, true)) {
              dropUuidReceiver(this)
              val uuids = try {
                uuidExtra(intent)
              } catch (_: Exception) {
                null
              }
              promise.resolve(uuids ?: cachedUuids(device))
            }
          } catch (_: Exception) {}
        }
      }
      try {
        val filter = IntentFilter(BluetoothDevice.ACTION_UUID)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        } else {
          @Suppress("UnspecifiedRegisterReceiverFlag")
          context.registerReceiver(receiver, filter)
        }
        uuidReceivers.add(receiver)
        if (!device.fetchUuidsWithSdp()) {
          if (settled.compareAndSet(false, true)) {
            dropUuidReceiver(receiver)
            promise.reject("BT_CLASSIC_SDP_FAILED", "fetchUuidsWithSdp returned false", null)
          }
          return@AsyncFunction
        }
      } catch (error: SecurityException) {
        if (settled.compareAndSet(false, true)) {
          dropUuidReceiver(receiver)
          promise.reject("BT_CLASSIC_PERMISSION", error.message, error)
        }
        return@AsyncFunction
      }
      val timeout = Runnable {
        try {
          Thread.sleep(timeoutMs.toLong().coerceIn(1_000L, 60_000L))
        } catch (_: InterruptedException) {}
        if (settled.compareAndSet(false, true)) {
          dropUuidReceiver(receiver)
          promise.resolve(cachedUuids(device))
        }
      }
      try {
        connectExecutor.execute(timeout)
      } catch (_: java.util.concurrent.RejectedExecutionException) {
        if (settled.compareAndSet(false, true)) {
          dropUuidReceiver(receiver)
          promise.reject("BT_CLASSIC_CANCELLED", null, null)
        }
      }
    }

    OnDestroy {
      destroyed.set(true)
      for (socket in pendingConnects.values) closeQuietly(socket)
      for (id in servers.keys.toList()) closeServer(id)
      for (receiver in uuidReceivers.toList()) dropUuidReceiver(receiver)
      for (id in sockets.keys.toList()) closeEntry(id, "local", null)
      try {
        adapter()?.cancelDiscovery()
      } catch (_: Exception) {}
      stopDiscoveryReceiver()
      connectExecutor.shutdownNow()
    }
  }

  private fun connectOnExecutor(
    adapter: BluetoothAdapter,
    address: String,
    serviceUuid: UUID,
    secure: Boolean,
    timeoutMs: Double,
    promise: Promise,
  ) {
    val socket = try {
      val device = adapter.getRemoteDevice(address)
      if (secure) device.createRfcommSocketToServiceRecord(serviceUuid)
      else device.createInsecureRfcommSocketToServiceRecord(serviceUuid)
    } catch (error: SecurityException) {
      promise.reject("BT_CLASSIC_PERMISSION", error.message, error)
      return
    } catch (error: IOException) {
      promise.reject("BT_CLASSIC_CONNECT_FAILED", error.message, error)
      return
    }
    pendingConnects[address] = socket
    // Exactly one of the watchdog and a finished connect claims the socket.
    val settled = AtomicBoolean(false)
    val timedOut = AtomicBoolean(false)
    // close() from another thread aborts a blocking connect().
    val watchdog = Thread {
      try {
        Thread.sleep(timeoutMs.toLong().coerceIn(1_000L, 120_000L))
        if (settled.compareAndSet(false, true)) {
          timedOut.set(true)
          closeQuietly(socket)
        }
      } catch (_: InterruptedException) {}
    }
    watchdog.isDaemon = true
    watchdog.start()
    try {
      // Discovery slows connects down a lot (BluetoothSocket.connect docs).
      // It needs BLUETOOTH_SCAN, which a connect does not require.
      try {
        adapter.cancelDiscovery()
      } catch (_: SecurityException) {}
      socket.connect()
      watchdog.interrupt()
      if (!settled.compareAndSet(false, true)) {
        closeQuietly(socket)
        promise.reject("BT_CLASSIC_CONNECT_TIMEOUT", null, null)
        return
      }
      if (destroyed.get()) {
        closeQuietly(socket)
        promise.reject("BT_CLASSIC_CANCELLED", null, null)
        return
      }
      val id = "rfcomm-${nextId.getAndIncrement()}"
      sockets[id] = SocketEntry(socket)
      promise.resolve(id)
    } catch (error: SecurityException) {
      watchdog.interrupt()
      closeQuietly(socket)
      promise.reject("BT_CLASSIC_PERMISSION", error.message, error)
    } catch (error: IOException) {
      watchdog.interrupt()
      settled.set(true)
      closeQuietly(socket)
      when {
        timedOut.get() -> promise.reject("BT_CLASSIC_CONNECT_TIMEOUT", null, error)
        destroyed.get() -> promise.reject("BT_CLASSIC_CANCELLED", null, error)
        else -> promise.reject("BT_CLASSIC_CONNECT_FAILED", error.message, error)
      }
    } finally {
      pendingConnects.remove(address)
    }
  }

  private fun acceptOnExecutor(serverId: String, entry: ServerEntry, timeoutMs: Double, promise: Promise) {
    // Exactly one of the watchdog and a finished accept claims the outcome.
    val settled = AtomicBoolean(false)
    val timedOut = AtomicBoolean(false)
    val watchdog = Thread {
      try {
        Thread.sleep(timeoutMs.toLong().coerceIn(1_000L, 300_000L))
        if (settled.compareAndSet(false, true)) {
          timedOut.set(true)
          closeServer(serverId)
        }
      } catch (_: InterruptedException) {}
    }
    watchdog.isDaemon = true
    watchdog.start()
    try {
      val socket = entry.server.accept()
      watchdog.interrupt()
      // One link per listen (connect-per-sync): no second device may attach.
      closeServer(serverId)
      if (!settled.compareAndSet(false, true)) {
        closeQuietly(socket)
        promise.reject("BT_CLASSIC_ACCEPT_TIMEOUT", null, null)
        return
      }
      if (destroyed.get()) {
        closeQuietly(socket)
        promise.reject("BT_CLASSIC_CANCELLED", null, null)
        return
      }
      val address = try {
        socket.remoteDevice.address
      } catch (_: Exception) {
        null
      }
      val id = "rfcomm-${nextId.getAndIncrement()}"
      sockets[id] = SocketEntry(socket)
      // OnDestroy may have swept the sockets before this entry landed.
      if (destroyed.get()) {
        closeEntry(id, "local", null)
        promise.reject("BT_CLASSIC_CANCELLED", null, null)
        return
      }
      promise.resolve(mapOf("socketId" to id, "address" to address))
    } catch (error: IOException) {
      watchdog.interrupt()
      settled.set(true)
      // Read before closeServer() below marks a still-open entry closed.
      val stopped = entry.closed.get()
      closeServer(serverId)
      when {
        timedOut.get() -> promise.reject("BT_CLASSIC_ACCEPT_TIMEOUT", null, error)
        destroyed.get() || stopped -> promise.reject("BT_CLASSIC_CANCELLED", null, error)
        else -> promise.reject("BT_CLASSIC_ACCEPT_FAILED", error.message, error)
      }
    } catch (error: SecurityException) {
      watchdog.interrupt()
      settled.set(true)
      closeServer(serverId)
      promise.reject("BT_CLASSIC_PERMISSION", error.message, error)
    } catch (error: Throwable) {
      // Anything escaping a pool thread would kill the process.
      watchdog.interrupt()
      settled.set(true)
      closeServer(serverId)
      promise.reject("BT_CLASSIC_ACCEPT_FAILED", error.message, error)
    }
  }

  /** Idempotent; closing aborts a blocking accept() on another thread. */
  private fun closeServer(serverId: String) {
    val entry = servers.remove(serverId) ?: return
    serverSlots.decrementAndGet()
    if (!entry.closed.compareAndSet(false, true)) return
    try {
      entry.server.close()
    } catch (_: IOException) {}
  }

  private fun dropUuidReceiver(receiver: BroadcastReceiver) {
    if (!uuidReceivers.remove(receiver)) return
    try {
      context.unregisterReceiver(receiver)
    } catch (_: Exception) {}
  }

  @Suppress("DEPRECATION")
  private fun uuidExtra(intent: Intent): List<String>? {
    // The typed overload is unreliable on API 33 (AndroidX IntentCompat only
    // uses it from 34), so take the untyped one below that.
    val values: Array<out android.os.Parcelable>? =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        intent.getParcelableArrayExtra(BluetoothDevice.EXTRA_UUID, ParcelUuid::class.java)
      } else {
        intent.getParcelableArrayExtra(BluetoothDevice.EXTRA_UUID)
      }
    return values?.mapNotNull { (it as? ParcelUuid)?.uuid?.toString() }
  }

  private fun cachedUuids(device: BluetoothDevice): List<String> =
    try {
      device.uuids?.map { it.uuid.toString() } ?: emptyList()
    } catch (_: SecurityException) {
      emptyList()
    }

  /** Idempotent: emits onClosed once per socket. */
  private fun closeEntry(socketId: String, reason: String, message: String?) {
    val entry = sockets.remove(socketId) ?: return
    if (!entry.closed.compareAndSet(false, true)) return
    closeQuietly(entry.socket)
    entry.writer.shutdown()
    if (!destroyed.get()) {
      sendEvent("onClosed", mapOf("socketId" to socketId, "reason" to reason, "message" to message))
    }
  }

  private fun usableAdapter(promise: Promise, permission: String): BluetoothAdapter? {
    if (destroyed.get()) {
      promise.reject("BT_CLASSIC_CANCELLED", null, null)
      return null
    }
    val adapter = try {
      adapter()
    } catch (_: IllegalStateException) {
      null
    }
    if (adapter == null) {
      promise.reject("BT_CLASSIC_UNSUPPORTED", null, null)
      return null
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
      context.checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED
    ) {
      promise.reject("BT_CLASSIC_PERMISSION", permission, null)
      return null
    }
    if (!adapter.isEnabled) {
      promise.reject("BT_CLASSIC_DISABLED", null, null)
      return null
    }
    return adapter
  }

  private fun stopDiscoveryReceiver() {
    val receiver = discoveryReceiver ?: return
    discoveryReceiver = null
    try {
      context.unregisterReceiver(receiver)
    } catch (_: Exception) {}
  }

  @Suppress("DEPRECATION")
  private fun deviceExtra(intent: Intent): BluetoothDevice? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
    } else {
      intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
    }

  private fun describe(device: BluetoothDevice): Map<String, Any?> {
    val name = try {
      device.name
    } catch (_: SecurityException) {
      null
    }
    val type = try {
      when (device.type) {
        BluetoothDevice.DEVICE_TYPE_CLASSIC -> "classic"
        BluetoothDevice.DEVICE_TYPE_LE -> "le"
        BluetoothDevice.DEVICE_TYPE_DUAL -> "dual"
        else -> "unknown"
      }
    } catch (_: SecurityException) {
      "unknown"
    }
    val bonded = try {
      device.bondState == BluetoothDevice.BOND_BONDED
    } catch (_: SecurityException) {
      false
    }
    return mapOf("address" to device.address, "name" to name, "type" to type, "bonded" to bonded)
  }

  private fun closeQuietly(socket: BluetoothSocket) {
    try {
      socket.close()
    } catch (_: IOException) {}
  }

  companion object {
    private const val MAX_SOCKETS = 4
    private const val MAX_SERVERS = 2
  }
}
