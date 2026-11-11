/** Shared direct-device identity vocabulary; data mirrors the native registries. */
export const DIRECT_DEVICE_FAMILIES = [
  "zepp_os",
  "xiaomi",
  "huawei",
  "garmin",
  "ble_gatt",
  "ble_scale",
  "colmi_ring",
  "bangle_js",
  "gloryfit",
  "huami_legacy",
  "moyoung",
  "fitpro",
] as const;
export type DirectDeviceFamily = (typeof DIRECT_DEVICE_FAMILIES)[number];
export type DirectDeviceIdentity = { family: DirectDeviceFamily; modelId: string };
export type DirectDeviceModelDescriptor = DirectDeviceIdentity & { displayName: string };

export const DIRECT_DEVICE_MODELS: readonly DirectDeviceModelDescriptor[] = [
  {
    family: "zepp_os",
    modelId: "amazfit_active",
    displayName: "Amazfit Active",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_active_2",
    displayName: "Amazfit Active 2",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_active_3_premium",
    displayName: "Amazfit Active 3 Premium",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_active_edge",
    displayName: "Amazfit Active Edge",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_active_max",
    displayName: "Amazfit Active Max",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_balance",
    displayName: "Amazfit Balance",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_balance_2",
    displayName: "Amazfit Balance 2",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_balance_2_xt",
    displayName: "Amazfit Balance 2 XT",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_balance_3",
    displayName: "Amazfit Balance 3",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_balance_ultra",
    displayName: "Amazfit Balance Ultra",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_band_7",
    displayName: "Amazfit Band 7",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_bip_5",
    displayName: "Amazfit Bip 5",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_bip_5_unity",
    displayName: "Amazfit Bip 5 Unity",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_bip_6",
    displayName: "Amazfit Bip 6",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_bip_max",
    displayName: "Amazfit Bip Max",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_cheetah",
    displayName: "Amazfit Cheetah",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_cheetah_2_pro",
    displayName: "Amazfit Cheetah 2 Pro",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_cheetah_2_ultra",
    displayName: "Amazfit Cheetah 2 Ultra",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_cheetah_pro",
    displayName: "Amazfit Cheetah Pro",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_falcon",
    displayName: "Amazfit Falcon",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_gtr_3",
    displayName: "Amazfit GTR 3",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_gtr_3_pro",
    displayName: "Amazfit GTR 3 Pro",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_gtr_4",
    displayName: "Amazfit GTR 4",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_gtr_mini",
    displayName: "Amazfit GTR Mini",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_gts_3",
    displayName: "Amazfit GTS 3",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_gts_4",
    displayName: "Amazfit GTS 4",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_gts_4_mini",
    displayName: "Amazfit GTS 4 Mini",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_gts_4_mini_new",
    displayName: "Amazfit GTS 4 Mini New",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_helio_ring",
    displayName: "Amazfit Helio Ring",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_helio_strap",
    displayName: "Amazfit Helio Strap",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_trex_2",
    displayName: "Amazfit T-Rex 2",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_trex_3",
    displayName: "Amazfit T-Rex 3",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_trex_3_pro",
    displayName: "Amazfit T-Rex 3 Pro",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_trex_ultra",
    displayName: "Amazfit T-Rex Ultra",
  },
  {
    family: "zepp_os",
    modelId: "amazfit_trex_ultra_2",
    displayName: "Amazfit T-Rex Ultra 2",
  },
  {
    family: "zepp_os",
    modelId: "xiaomi_mi_band_7",
    displayName: "Xiaomi Smart Band 7",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_mi_band_10",
    displayName: "Xiaomi Smart Band 10",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_mi_band_10_pro",
    displayName: "Xiaomi Smart Band 10 Pro",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_mi_band_11",
    displayName: "Xiaomi Smart Band 11",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_mi_band_11_active",
    displayName: "Xiaomi Smart Band 11 Active",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_mi_band_4c",
    displayName: "Mi Smart Band 4C",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_mi_band_7_pro",
    displayName: "Xiaomi Smart Band 7 Pro",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_mi_band_8",
    displayName: "Xiaomi Smart Band 8",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_mi_band_8_active",
    displayName: "Xiaomi Smart Band 8 Active",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_mi_band_8_pro",
    displayName: "Xiaomi Smart Band 8 Pro",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_mi_band_9",
    displayName: "Xiaomi Smart Band 9",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_mi_band_9_active",
    displayName: "Xiaomi Smart Band 9 Active",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_mi_band_9_pro",
    displayName: "Xiaomi Smart Band 9 Pro",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_mi_watch_color_sport",
    displayName: "Mi Watch Color Sport",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_mi_watch_lite",
    displayName: "Mi Watch Lite",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_redmi_smart_band_2",
    displayName: "Redmi Smart Band 2",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_redmi_smart_band_3",
    displayName: "Redmi Smart Band 3",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_redmi_smart_band_pro",
    displayName: "Redmi Smart Band Pro",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_redmi_watch_2",
    displayName: "Redmi Watch 2",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_redmi_watch_2_lite",
    displayName: "Redmi Watch 2 Lite",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_redmi_watch_3",
    displayName: "Redmi Watch 3",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_redmi_watch_3_active",
    displayName: "Redmi Watch 3 Active",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_redmi_watch_4",
    displayName: "Redmi Watch 4",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_redmi_watch_5",
    displayName: "Redmi Watch 5",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_redmi_watch_5_active",
    displayName: "Redmi Watch 5 Active",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_redmi_watch_5_lite",
    displayName: "Redmi Watch 5 Lite",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_redmi_watch_6",
    displayName: "Redmi Watch 6",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_redmi_watch_move",
    displayName: "Redmi Watch Move",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_watch_5",
    displayName: "Xiaomi Watch 5",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_watch_s1",
    displayName: "Xiaomi Watch S1",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_watch_s1_active",
    displayName: "Xiaomi Watch S1 Active",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_watch_s1_pro",
    displayName: "Xiaomi Watch S1 Pro",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_watch_s3",
    displayName: "Xiaomi Watch S3",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_watch_s4",
    displayName: "Xiaomi Watch S4",
  },
  {
    family: "xiaomi",
    modelId: "xiaomi_watch_s5",
    displayName: "Xiaomi Watch S5",
  },
  {
    family: "huawei",
    modelId: "honor_band_3",
    displayName: "Honor Band 3",
  },
  {
    family: "huawei",
    modelId: "honor_band_4",
    displayName: "Honor Band 4",
  },
  {
    family: "huawei",
    modelId: "honor_band_5",
    displayName: "Honor Band 5",
  },
  {
    family: "huawei",
    modelId: "honor_band_6",
    displayName: "Honor Band 6",
  },
  {
    family: "huawei",
    modelId: "honor_band_7",
    displayName: "Honor Band 7",
  },
  {
    family: "huawei",
    modelId: "honor_band_9",
    displayName: "Honor Band 9",
  },
  {
    family: "huawei",
    modelId: "honor_band_10",
    displayName: "Honor Band 10",
  },
  {
    family: "huawei",
    modelId: "honor_magic_watch",
    displayName: "Honor Magic Watch",
  },
  {
    family: "huawei",
    modelId: "honor_magicwatch_2",
    displayName: "Honor MagicWatch 2",
  },
  {
    family: "huawei",
    modelId: "honor_watch_4",
    displayName: "Honor Watch 4",
  },
  {
    family: "huawei",
    modelId: "honor_watch_4_pro",
    displayName: "Honor Watch 4 Pro",
  },
  {
    family: "huawei",
    modelId: "honor_watch_5",
    displayName: "Honor Watch 5",
  },
  {
    family: "huawei",
    modelId: "honor_watch_5_pro",
    displayName: "Honor Watch 5 Pro",
  },
  {
    family: "huawei",
    modelId: "honor_watch_6",
    displayName: "Honor Watch 6",
  },
  {
    family: "huawei",
    modelId: "honor_watch_gs_3",
    displayName: "Honor Watch GS 3",
  },
  {
    family: "huawei",
    modelId: "honor_watch_gs_pro",
    displayName: "Honor Watch GS Pro",
  },
  {
    family: "huawei",
    modelId: "huawei_band_2",
    displayName: "Huawei Band 2",
  },
  {
    family: "huawei",
    modelId: "huawei_band_2_pro",
    displayName: "Huawei Band 2 Pro",
  },
  {
    family: "huawei",
    modelId: "huawei_band_3_pro",
    displayName: "Huawei Band 3 Pro",
  },
  {
    family: "huawei",
    modelId: "huawei_band_4",
    displayName: "Huawei Band 4",
  },
  {
    family: "huawei",
    modelId: "huawei_band_4_pro",
    displayName: "Huawei Band 4 Pro",
  },
  {
    family: "huawei",
    modelId: "huawei_band_6",
    displayName: "Huawei Band 6",
  },
  {
    family: "huawei",
    modelId: "huawei_band_7",
    displayName: "Huawei Band 7",
  },
  {
    family: "huawei",
    modelId: "huawei_band_8",
    displayName: "Huawei Band 8",
  },
  {
    family: "huawei",
    modelId: "huawei_band_9",
    displayName: "Huawei Band 9",
  },
  {
    family: "huawei",
    modelId: "huawei_band_10",
    displayName: "Huawei Band 10",
  },
  {
    family: "huawei",
    modelId: "huawei_band_11",
    displayName: "Huawei Band 11",
  },
  {
    family: "huawei",
    modelId: "huawei_band_11_pro",
    displayName: "Huawei Band 11 Pro",
  },
  {
    family: "huawei",
    modelId: "huawei_band_3e",
    displayName: "Huawei Band 3e",
  },
  {
    family: "huawei",
    modelId: "huawei_band_4e",
    displayName: "Huawei Band 4e",
  },
  {
    family: "huawei",
    modelId: "huawei_talk_band_b6",
    displayName: "Huawei Talk Band B6",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_3",
    displayName: "Huawei Watch 3",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_3_pro",
    displayName: "Huawei Watch 3 Pro",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_4",
    displayName: "Huawei Watch 4",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_4_pro",
    displayName: "Huawei Watch 4 Pro",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_5",
    displayName: "Huawei Watch 5",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_6",
    displayName: "Huawei Watch 6",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_6_pro",
    displayName: "Huawei Watch 6 Pro",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_d2",
    displayName: "Huawei Watch D2",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_d3",
    displayName: "Huawei Watch D3",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_gt",
    displayName: "Huawei Watch GT",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_gt_2",
    displayName: "Huawei Watch GT 2",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_gt_2_pro",
    displayName: "Huawei Watch GT 2 Pro",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_gt_2e",
    displayName: "Huawei Watch GT 2e",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_gt_3",
    displayName: "Huawei Watch GT 3",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_gt_3_pro",
    displayName: "Huawei Watch GT 3 Pro",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_gt_3_se",
    displayName: "Huawei Watch GT 3 SE",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_gt_4",
    displayName: "Huawei Watch GT 4",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_gt_5",
    displayName: "Huawei Watch GT 5",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_gt_5_pro",
    displayName: "Huawei Watch GT 5 Pro",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_gt_6",
    displayName: "Huawei Watch GT 6",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_gt_6_pro",
    displayName: "Huawei Watch GT 6 Pro",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_gt_7",
    displayName: "Huawei Watch GT 7",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_gt_7_pro",
    displayName: "Huawei Watch GT 7 Pro",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_gt_cyber",
    displayName: "Huawei Watch GT Cyber",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_gt_runner",
    displayName: "Huawei Watch GT Runner",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_gt_runner_2",
    displayName: "Huawei Watch GT Runner 2",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_fit",
    displayName: "Huawei Watch Fit",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_fit_2",
    displayName: "Huawei Watch Fit 2",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_fit_3",
    displayName: "Huawei Watch Fit 3",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_fit_4",
    displayName: "Huawei Watch Fit 4",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_fit_4_pro",
    displayName: "Huawei Watch Fit 4 Pro",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_fit_5",
    displayName: "Huawei Watch Fit 5",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_fit_5_pro",
    displayName: "Huawei Watch Fit 5 Pro",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_ultimate",
    displayName: "Huawei Watch Ultimate",
  },
  {
    family: "huawei",
    modelId: "huawei_watch_ultimate_2",
    displayName: "Huawei Watch Ultimate 2",
  },
  {
    family: "garmin",
    modelId: "garmin_cirqa",
    displayName: "Garmin CIRQA",
  },
  {
    family: "garmin",
    modelId: "garmin_d2_air",
    displayName: "Garmin D2 Air",
  },
  {
    family: "garmin",
    modelId: "garmin_d2_air_x10",
    displayName: "Garmin D2 Air X10",
  },
  {
    family: "garmin",
    modelId: "garmin_d2_air_x15",
    displayName: "Garmin D2 Air X15",
  },
  {
    family: "garmin",
    modelId: "garmin_d2_mach_1",
    displayName: "Garmin D2 Mach 1",
  },
  {
    family: "garmin",
    modelId: "garmin_d2_mach_1_pro",
    displayName: "Garmin D2 Mach 1 Pro",
  },
  {
    family: "garmin",
    modelId: "garmin_d2_mach_2",
    displayName: "Garmin D2 Mach 2",
  },
  {
    family: "garmin",
    modelId: "garmin_d2_mach_2_pro",
    displayName: "Garmin D2 Mach 2 Pro",
  },
  {
    family: "garmin",
    modelId: "garmin_enduro",
    displayName: "Garmin Enduro",
  },
  {
    family: "garmin",
    modelId: "garmin_enduro_3",
    displayName: "Garmin Enduro 3",
  },
  {
    family: "garmin",
    modelId: "garmin_enduro_4",
    displayName: "Garmin Enduro 4",
  },
  {
    family: "garmin",
    modelId: "garmin_enduro_2",
    displayName: "Garmin Enduro 2",
  },
  {
    family: "garmin",
    modelId: "garmin_epix",
    displayName: "Garmin Epix",
  },
  {
    family: "garmin",
    modelId: "garmin_epix_pro",
    displayName: "Garmin Epix Pro",
  },
  {
    family: "garmin",
    modelId: "garmin_epix_gen2",
    displayName: "Garmin Epix (Gen 2)",
  },
  {
    family: "garmin",
    modelId: "garmin_descent_g1",
    displayName: "Garmin Descent G1",
  },
  {
    family: "garmin",
    modelId: "garmin_descent_g2",
    displayName: "Garmin Descent G2",
  },
  {
    family: "garmin",
    modelId: "garmin_descent_mk3",
    displayName: "Garmin Descent Mk3",
  },
  {
    family: "garmin",
    modelId: "garmin_descent_mk3i",
    displayName: "Garmin Descent Mk3i",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_2",
    displayName: "Garmin Fenix 2",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_3_chronos",
    displayName: "Garmin Fenix 3 Chronos",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_5",
    displayName: "Garmin Fenix 5",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_5_plus",
    displayName: "Garmin Fenix 5 Plus",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_5s",
    displayName: "Garmin Fenix 5S",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_5s_plus",
    displayName: "Garmin Fenix 5S Plus",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_5x",
    displayName: "Garmin Fenix 5X",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_5x_plus",
    displayName: "Garmin Fenix 5X Plus",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_6",
    displayName: "Garmin Fenix 6",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_6s",
    displayName: "Garmin Fenix 6S",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_6_pro",
    displayName: "Garmin Fenix 6 Pro",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_6_sapphire",
    displayName: "Garmin Fenix 6 Sapphire",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_6s_pro",
    displayName: "Garmin Fenix 6S Pro",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_6s_pro_solar",
    displayName: "Garmin Fenix 6S Pro Solar",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_6x",
    displayName: "Garmin Fenix 6X",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_6x_pro",
    displayName: "Garmin Fenix 6X Pro",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_6s_sapphire",
    displayName: "Garmin Fenix 6S Sapphire",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_6x_pro_solar",
    displayName: "Garmin Fenix 6X Pro Solar",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_6x_sapphire",
    displayName: "Garmin Fenix 6X Sapphire",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_6_sport",
    displayName: "Garmin Fenix 6 Sport",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_6s_sport",
    displayName: "Garmin Fenix 6S Sport",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_7",
    displayName: "Garmin Fenix 7",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_7s",
    displayName: "Garmin Fenix 7S",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_7s_pro",
    displayName: "Garmin Fenix 7S Pro",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_7s_pro_solar",
    displayName: "Garmin Fenix 7S Pro Solar",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_7x",
    displayName: "Garmin Fenix 7X",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_7x_pro",
    displayName: "Garmin Fenix 7X Pro",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_7x_pro_solar",
    displayName: "Garmin Fenix 7X Pro Solar",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_7_pro",
    displayName: "Garmin Fenix 7 Pro",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_7_pro_solar",
    displayName: "Garmin Fenix 7 Pro Solar",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_8",
    displayName: "Garmin Fenix 8",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_8_solar",
    displayName: "Garmin Fenix 8 Solar",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_8_pro",
    displayName: "Garmin Fenix 8 Pro",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_9",
    displayName: "Garmin Fenix 9",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_9_pro",
    displayName: "Garmin Fenix 9 Pro",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_9_pro_solar",
    displayName: "Garmin Fenix 9 Pro Solar",
  },
  {
    family: "garmin",
    modelId: "garmin_fenix_e",
    displayName: "Garmin Fenix E",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_25",
    displayName: "Garmin Forerunner 25",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_30",
    displayName: "Garmin Forerunner 30",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_220",
    displayName: "Garmin Forerunner 220",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_225",
    displayName: "Garmin Forerunner 225",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_35",
    displayName: "Garmin Forerunner 35",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_45",
    displayName: "Garmin Forerunner 45",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_45_plus",
    displayName: "Garmin Forerunner 45 Plus",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_55",
    displayName: "Garmin Forerunner 55",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_70",
    displayName: "Garmin Forerunner 70",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_165",
    displayName: "Garmin Forerunner 165",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_165_music",
    displayName: "Garmin Forerunner 165 Music",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_170",
    displayName: "Garmin Forerunner 170",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_170_music",
    displayName: "Garmin Forerunner 170 Music",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_230",
    displayName: "Garmin Forerunner 230",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_235",
    displayName: "Garmin Forerunner 235",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_245",
    displayName: "Garmin Forerunner 245",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_245_music",
    displayName: "Garmin Forerunner 245 Music",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_255",
    displayName: "Garmin Forerunner 255",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_255_music",
    displayName: "Garmin Forerunner 255 Music",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_255s",
    displayName: "Garmin Forerunner 255S",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_255s_music",
    displayName: "Garmin Forerunner 255S Music",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_265",
    displayName: "Garmin Forerunner 265",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_265s",
    displayName: "Garmin Forerunner 265S",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_570",
    displayName: "Garmin Forerunner 570",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_620",
    displayName: "Garmin Forerunner 620",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_630",
    displayName: "Garmin Forerunner 630",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_645",
    displayName: "Garmin Forerunner 645",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_645_music",
    displayName: "Garmin Forerunner 645 Music",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_735xt",
    displayName: "Garmin Forerunner 735XT",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_745",
    displayName: "Garmin Forerunner 745",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_920",
    displayName: "Garmin Forerunner 920",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_935",
    displayName: "Garmin Forerunner 935",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_945",
    displayName: "Garmin Forerunner 945",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_945_lte",
    displayName: "Garmin Forerunner 945 LTE",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_955",
    displayName: "Garmin Forerunner 955",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_965",
    displayName: "Garmin Forerunner 965",
  },
  {
    family: "garmin",
    modelId: "garmin_forerunner_970",
    displayName: "Garmin Forerunner 970",
  },
  {
    family: "garmin",
    modelId: "garmin_instinct",
    displayName: "Garmin Instinct",
  },
  {
    family: "garmin",
    modelId: "garmin_instinct_2",
    displayName: "Garmin Instinct 2",
  },
  {
    family: "garmin",
    modelId: "garmin_instinct_2_solar",
    displayName: "Garmin Instinct 2 Solar",
  },
  {
    family: "garmin",
    modelId: "garmin_instinct_2_soltac",
    displayName: "Garmin Instinct 2 SolTac",
  },
  {
    family: "garmin",
    modelId: "garmin_instinct_2s",
    displayName: "Garmin Instinct 2S",
  },
  {
    family: "garmin",
    modelId: "garmin_instinct_2s_solar",
    displayName: "Garmin Instinct 2S Solar",
  },
  {
    family: "garmin",
    modelId: "garmin_instinct_2s_surf",
    displayName: "Garmin Instinct 2S Surf",
  },
  {
    family: "garmin",
    modelId: "garmin_instinct_2x",
    displayName: "Garmin Instinct 2X",
  },
  {
    family: "garmin",
    modelId: "garmin_instinct_2x_solar",
    displayName: "Garmin Instinct 2X Solar",
  },
  {
    family: "garmin",
    modelId: "garmin_instinct_2x_tactical",
    displayName: "Garmin Instinct 2X Tactical",
  },
  {
    family: "garmin",
    modelId: "garmin_instinct_3",
    displayName: "Garmin Instinct 3",
  },
  {
    family: "garmin",
    modelId: "garmin_instinct_3_tactical",
    displayName: "Garmin Instinct 3 Tactical",
  },
  {
    family: "garmin",
    modelId: "garmin_instinct_3_solar",
    displayName: "Garmin Instinct 3 Solar",
  },
  {
    family: "garmin",
    modelId: "garmin_instinct_3_solar_tactical",
    displayName: "Garmin Instinct 3 Solar Tactical",
  },
  {
    family: "garmin",
    modelId: "garmin_instinct_crossover",
    displayName: "Garmin Instinct Crossover",
  },
  {
    family: "garmin",
    modelId: "garmin_instinct_tactical",
    displayName: "Garmin Instinct Tactical",
  },
  {
    family: "garmin",
    modelId: "garmin_instinct_e",
    displayName: "Garmin Instinct E",
  },
  {
    family: "garmin",
    modelId: "garmin_lily",
    displayName: "Garmin Lily",
  },
  {
    family: "garmin",
    modelId: "garmin_lily_2",
    displayName: "Garmin Lily 2",
  },
  {
    family: "garmin",
    modelId: "garmin_lily_2_active",
    displayName: "Garmin Lily 2 Active",
  },
  {
    family: "garmin",
    modelId: "garmin_instinct_solar",
    displayName: "Garmin Instinct Solar",
  },
  {
    family: "garmin",
    modelId: "garmin_instinct_solar_tactical",
    displayName: "Garmin Instinct Solar Tactical",
  },
  {
    family: "garmin",
    modelId: "garmin_quatix_6",
    displayName: "Garmin Quatix 6",
  },
  {
    family: "garmin",
    modelId: "garmin_quatix_6x",
    displayName: "Garmin Quatix 6X",
  },
  {
    family: "garmin",
    modelId: "garmin_quatix_8",
    displayName: "Garmin Quatix 8",
  },
  {
    family: "garmin",
    modelId: "garmin_tactix_7",
    displayName: "Garmin Tactix 7",
  },
  {
    family: "garmin",
    modelId: "garmin_tactix_8",
    displayName: "Garmin Tactix 8",
  },
  {
    family: "garmin",
    modelId: "garmin_tactix_8_solar",
    displayName: "Garmin Tactix 8 Solar",
  },
  {
    family: "garmin",
    modelId: "garmin_swim_2",
    displayName: "Garmin Swim 2",
  },
  {
    family: "garmin",
    modelId: "garmin_venu",
    displayName: "Garmin Venu",
  },
  {
    family: "garmin",
    modelId: "garmin_venu_sq",
    displayName: "Garmin Venu Sq",
  },
  {
    family: "garmin",
    modelId: "garmin_venu_sq_music",
    displayName: "Garmin Venu Sq Music",
  },
  {
    family: "garmin",
    modelId: "garmin_venu_sq_2",
    displayName: "Garmin Venu Sq 2",
  },
  {
    family: "garmin",
    modelId: "garmin_venu_sq_2_music",
    displayName: "Garmin Venu Sq 2 Music",
  },
  {
    family: "garmin",
    modelId: "garmin_venu_2",
    displayName: "Garmin Venu 2",
  },
  {
    family: "garmin",
    modelId: "garmin_venu_2s",
    displayName: "Garmin Venu 2S",
  },
  {
    family: "garmin",
    modelId: "garmin_venu_2_plus",
    displayName: "Garmin Venu 2 Plus",
  },
  {
    family: "garmin",
    modelId: "garmin_venu_3",
    displayName: "Garmin Venu 3",
  },
  {
    family: "garmin",
    modelId: "garmin_venu_3s",
    displayName: "Garmin Venu 3S",
  },
  {
    family: "garmin",
    modelId: "garmin_venu_4",
    displayName: "Garmin Venu 4",
  },
  {
    family: "garmin",
    modelId: "garmin_venu_x1",
    displayName: "Garmin Venu X1",
  },
  {
    family: "garmin",
    modelId: "garmin_vivoactive",
    displayName: "Garmin Vívoactive",
  },
  {
    family: "garmin",
    modelId: "garmin_vivoactive_3",
    displayName: "Garmin Vívoactive 3",
  },
  {
    family: "garmin",
    modelId: "garmin_vivoactive_3t",
    displayName: "Garmin Vívoactive 3T",
  },
  {
    family: "garmin",
    modelId: "garmin_vivoactive_3_music",
    displayName: "Garmin Vívoactive 3 Music",
  },
  {
    family: "garmin",
    modelId: "garmin_vivoactive_4",
    displayName: "Garmin Vívoactive 4",
  },
  {
    family: "garmin",
    modelId: "garmin_vivoactive_4s",
    displayName: "Garmin Vívoactive 4S",
  },
  {
    family: "garmin",
    modelId: "garmin_vivoactive_5",
    displayName: "Garmin Vívoactive 5",
  },
  {
    family: "garmin",
    modelId: "garmin_vivoactive_6",
    displayName: "Garmin Vívoactive 6",
  },
  {
    family: "garmin",
    modelId: "garmin_vivoactive_hr",
    displayName: "Garmin Vívoactive HR",
  },
  {
    family: "garmin",
    modelId: "garmin_vivosmart",
    displayName: "Garmin Vívosmart",
  },
  {
    family: "garmin",
    modelId: "garmin_vivosmart_hr",
    displayName: "Garmin Vívosmart HR",
  },
  {
    family: "garmin",
    modelId: "garmin_vivosmart_hr_plus",
    displayName: "Garmin Vívosmart HR+",
  },
  {
    family: "garmin",
    modelId: "garmin_vivosmart_3",
    displayName: "Garmin Vívosmart 3",
  },
  {
    family: "garmin",
    modelId: "garmin_vivosmart_4",
    displayName: "Garmin Vívosmart 4",
  },
  {
    family: "garmin",
    modelId: "garmin_vivosmart_5",
    displayName: "Garmin Vívosmart 5",
  },
  {
    family: "garmin",
    modelId: "garmin_vivomove",
    displayName: "Garmin Vívomove",
  },
  {
    family: "garmin",
    modelId: "garmin_vivomove_hr",
    displayName: "Garmin Vívomove HR",
  },
  {
    family: "garmin",
    modelId: "garmin_vivomove_sport",
    displayName: "Garmin Vívomove Sport",
  },
  {
    family: "garmin",
    modelId: "garmin_vivomove_style",
    displayName: "Garmin Vívomove Style",
  },
  {
    family: "garmin",
    modelId: "garmin_vivomove_trend",
    displayName: "Garmin Vívomove Trend",
  },
  {
    family: "garmin",
    modelId: "garmin_vivosport",
    displayName: "Garmin Vívosport",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_25",
    displayName: "Garmin Edge 25",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_130",
    displayName: "Garmin Edge 130",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_130_plus",
    displayName: "Garmin Edge 130 Plus",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_510",
    displayName: "Garmin Edge 510",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_520",
    displayName: "Garmin Edge 520",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_520_plus",
    displayName: "Garmin Edge 520 Plus",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_530",
    displayName: "Garmin Edge 530",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_540",
    displayName: "Garmin Edge 540",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_550",
    displayName: "Garmin Edge 550",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_810",
    displayName: "Garmin Edge 810",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_820",
    displayName: "Garmin Edge 820",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_830",
    displayName: "Garmin Edge 830",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_840",
    displayName: "Garmin Edge 840",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_850",
    displayName: "Garmin Edge 850",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_1000",
    displayName: "Garmin Edge 1000",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_1030",
    displayName: "Garmin Edge 1030",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_1030_plus",
    displayName: "Garmin Edge 1030 Plus",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_1040",
    displayName: "Garmin Edge 1040",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_1050",
    displayName: "Garmin Edge 1050",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_explore",
    displayName: "Garmin Edge Explore",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_explore_2",
    displayName: "Garmin Edge Explore 2",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_explore_820",
    displayName: "Garmin Edge Explore 820",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_explore_1000",
    displayName: "Garmin Edge Explore 1000",
  },
  {
    family: "garmin",
    modelId: "garmin_edge_mtb",
    displayName: "Garmin Edge MTB",
  },
  {
    family: "garmin",
    modelId: "garmin_etrex_se",
    displayName: "Garmin eTrex SE",
  },
  {
    family: "garmin",
    modelId: "garmin_gpsmap_66s",
    displayName: "Garmin GPSMAP 66s",
  },
  {
    family: "garmin",
    modelId: "garmin_gpsmap_66sr",
    displayName: "Garmin GPSMAP 66sr",
  },
  {
    family: "garmin",
    modelId: "garmin_gpsmap_66i",
    displayName: "Garmin GPSMAP 66i",
  },
  {
    family: "garmin",
    modelId: "garmin_gpsmap_h1",
    displayName: "Garmin GPSMAP H1",
  },
  {
    family: "garmin",
    modelId: "garmin_hrm_200",
    displayName: "Garmin HRM 200",
  },
  {
    family: "garmin",
    modelId: "garmin_hrm_600",
    displayName: "Garmin HRM 600",
  },
  {
    family: "garmin",
    modelId: "garmin_hrm_pro_plus",
    displayName: "Garmin HRM Pro Plus",
  },
  {
    family: "garmin",
    modelId: "garmin_inreach_mini_2",
    displayName: "Garmin inReach Mini 2",
  },
  {
    family: "garmin",
    modelId: "garmin_quatix_7",
    displayName: "Garmin Quatix 7",
  },
  {
    family: "garmin",
    modelId: "garmin_quatix_7x",
    displayName: "Garmin Quatix 7X",
  },
  // BLE GATT sensors: heart-rate bands, blood-pressure monitors and
  // thermometers that publish standard GATT characteristics.
  {
    family: "ble_gatt",
    modelId: "polar_h10",
    displayName: "Polar H10",
  },
  {
    family: "ble_gatt",
    modelId: "polar_h9",
    displayName: "Polar H9",
  },
  {
    family: "ble_gatt",
    modelId: "coospo_h6",
    displayName: "Coospo H6",
  },
  {
    family: "ble_gatt",
    modelId: "coospo_h9z",
    displayName: "Coospo H9Z",
  },
  {
    family: "ble_gatt",
    modelId: "coospo_hw807",
    displayName: "Coospo HW807",
  },
  {
    family: "ble_gatt",
    modelId: "coospo_hw9",
    displayName: "Coospo HW9",
  },
  {
    family: "ble_gatt",
    modelId: "beurer_bm59",
    displayName: "Beurer BM59",
  },
  {
    family: "ble_gatt",
    modelId: "beurer_bm69",
    displayName: "Beurer BM69",
  },
  {
    family: "ble_gatt",
    modelId: "sanitas_sbm67",
    displayName: "Sanitas SBM67",
  },
  {
    family: "ble_gatt",
    modelId: "femometer_vinca_2",
    displayName: "Femometer Vinca 2",
  },
  {
    family: "ble_gatt",
    modelId: "generic_heart_rate_sensor",
    displayName: "Generic Heart Rate Sensor",
  },
  {
    family: "ble_gatt",
    modelId: "generic_blood_pressure_monitor",
    displayName: "Generic Blood Pressure Monitor",
  },
  {
    family: "ble_gatt",
    modelId: "generic_health_thermometer",
    displayName: "Generic Health Thermometer",
  },
  // PineTime running InfiniTime (Issue #428): standard GATT live heart rate
  // (0x180D/0x2A37) only. InfiniTime exposes no history fetch, so this is a
  // live-sensor identity rather than a history source.
  {
    family: "ble_gatt",
    modelId: "pinetime_p8",
    displayName: "PineTime (InfiniTime)",
  },
  // BLE smart scales (Issue #424): weight plus optional bio-impedance body
  // composition. The native lane owns the GATT parser; these rows only carry
  // the shared identity vocabulary.
  {
    family: "ble_scale",
    modelId: "xiaomi_smart_scale_2",
    displayName: "Xiaomi Smart Scale 2",
  },
  {
    family: "ble_scale",
    modelId: "xiaomi_body_composition_scale_2",
    displayName: "Xiaomi Body Composition Scale 2",
  },
  {
    family: "ble_scale",
    modelId: "lefu_health_scale",
    displayName: "Lefu Health Scale",
  },
  {
    family: "ble_scale",
    modelId: "chipsea_qn_scale",
    displayName: "Chipsea QN Scale",
  },
  {
    family: "ble_scale",
    modelId: "ge_fit_plus",
    displayName: "GE Fit Plus",
  },
  {
    family: "ble_scale",
    modelId: "viatom_f8",
    displayName: "Viatom F8",
  },
  // Colmi/Yawell smart rings (Issue #425): arbitrary-interval steps and sleep
  // sessions. The native lane owns the BLE protocol; these rows only carry the
  // shared identity vocabulary. None are transport-validated yet.
  {
    family: "colmi_ring",
    modelId: "colmi_r02",
    displayName: "Colmi R02",
  },
  {
    family: "colmi_ring",
    modelId: "colmi_r03",
    displayName: "Colmi R03",
  },
  {
    family: "colmi_ring",
    modelId: "colmi_r06",
    displayName: "Colmi R06",
  },
  {
    family: "colmi_ring",
    modelId: "colmi_r07",
    displayName: "Colmi R07",
  },
  {
    family: "colmi_ring",
    modelId: "colmi_r09",
    displayName: "Colmi R09",
  },
  {
    family: "colmi_ring",
    modelId: "colmi_r10",
    displayName: "Colmi R10",
  },
  {
    family: "colmi_ring",
    modelId: "colmi_r12",
    displayName: "Colmi R12",
  },
  {
    family: "colmi_ring",
    modelId: "yawell_r05",
    displayName: "Yawell R05",
  },
  {
    family: "colmi_ring",
    modelId: "yawell_r10",
    displayName: "Yawell R10",
  },
  {
    family: "colmi_ring",
    modelId: "yawell_r11",
    displayName: "Yawell R11",
  },
  {
    family: "colmi_ring",
    modelId: "yawell_ai_health_watchpad",
    displayName: "Yawell Y27 AI Health WatchPad",
  },
  // Bangle.js smartwatches via Gadgetbridge (Issue #428): history arrives as
  // 10-minute activity buckets plus heart rate. The native lane owns the BLE
  // protocol; these rows only carry the shared identity vocabulary.
  {
    family: "bangle_js",
    modelId: "bangle_js_1",
    displayName: "Bangle.js 1",
  },
  {
    family: "bangle_js",
    modelId: "bangle_js_2",
    displayName: "Bangle.js 2",
  },
  // GloryFit-protocol watches (Issue #426): hourly step buckets, 10-minute
  // heart-rate blocks and sleep sessions with stages. The native lane owns the
  // BLE protocol; these rows only carry the shared identity vocabulary. The
  // family covers every vendor the upstream device catalog maps to the GloryFit
  // coordinator (gloryfit, hifuture, imiki, grv, kieslect, oukitel, haylou).
  // None are transport-validated yet.
  {
    family: "gloryfit",
    modelId: "gloryfit_d3",
    displayName: "GloryFit D3",
  },
  {
    family: "gloryfit",
    modelId: "gloryfit_r1",
    displayName: "GloryFit R1",
  },
  {
    family: "gloryfit",
    modelId: "gloryfit_s52",
    displayName: "GloryFit S52",
  },
  {
    family: "gloryfit",
    modelId: "gloryfit_swiss_peak",
    displayName: "GloryFit Swiss Peak",
  },
  {
    family: "gloryfit",
    modelId: "gloryfit_t70",
    displayName: "GloryFit T70",
  },
  {
    family: "gloryfit",
    modelId: "gloryfit_y6",
    displayName: "GloryFit Y6",
  },
  {
    family: "gloryfit",
    modelId: "gloryfit_y66",
    displayName: "GloryFit Y66",
  },
  {
    family: "gloryfit",
    modelId: "blackview_r3max",
    displayName: "Blackview R3 Max",
  },
  {
    family: "gloryfit",
    modelId: "colmi_p10",
    displayName: "Colmi P10",
  },
  {
    family: "gloryfit",
    modelId: "dotn_p66d",
    displayName: "Dotn P66D",
  },
  {
    family: "gloryfit",
    modelId: "grv_fc1",
    displayName: "GRV FC1",
  },
  {
    family: "gloryfit",
    modelId: "haylou_watch_2_pro",
    displayName: "Haylou Watch 2 Pro",
  },
  {
    family: "gloryfit",
    modelId: "hifuture_zone_2",
    displayName: "HiFuture Zone 2",
  },
  {
    family: "gloryfit",
    modelId: "imiki_frame_2",
    displayName: "IMIKI Frame 2",
  },
  {
    family: "gloryfit",
    modelId: "kieslect_calling_smartwatch_kr_pro",
    displayName: "Kieslect Kr Pro",
  },
  {
    family: "gloryfit",
    modelId: "oukitel_bt103",
    displayName: "Oukitel BT103",
  },
  {
    family: "gloryfit",
    modelId: "qecnato_s10",
    displayName: "Qecnato S10",
  },
  // Legacy Huami (Issue #419): the pre-Zepp-OS Amazfit/Mi Band generation that
  // speaks the Mi Band auth + activity-fetch protocol. History arrives as
  // per-minute activity samples (exact-minute steps and heart rate) plus sleep
  // derived from activity kinds 9/11. The native lane owns the BLE protocol;
  // these rows only carry the shared identity vocabulary. None are
  // transport-validated yet.
  {
    family: "huami_legacy",
    modelId: "amazfit_bip",
    displayName: "Amazfit Bip",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_bip_lite",
    displayName: "Amazfit Bip Lite",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_bip_s",
    displayName: "Amazfit Bip S",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_bip_s_lite",
    displayName: "Amazfit Bip S Lite",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_bip_u",
    displayName: "Amazfit Bip U",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_bip_u_pro",
    displayName: "Amazfit Bip U Pro",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_bip_3",
    displayName: "Amazfit Bip 3",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_bip_3_pro",
    displayName: "Amazfit Bip 3 Pro",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_cor",
    displayName: "Amazfit Cor",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_cor_2",
    displayName: "Amazfit Cor 2",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_gtr",
    displayName: "Amazfit GTR",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_gtr_lite",
    displayName: "Amazfit GTR Lite",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_gtr_2",
    displayName: "Amazfit GTR 2",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_gtr_2e",
    displayName: "Amazfit GTR 2e",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_gts",
    displayName: "Amazfit GTS",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_gts_2",
    displayName: "Amazfit GTS 2",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_gts_2e",
    displayName: "Amazfit GTS 2e",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_gts_2_mini",
    displayName: "Amazfit GTS 2 Mini",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_neo",
    displayName: "Amazfit Neo",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_pop",
    displayName: "Amazfit Pop",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_pop_pro",
    displayName: "Amazfit Pop Pro",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_trex",
    displayName: "Amazfit T-Rex",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_trex_pro",
    displayName: "Amazfit T-Rex Pro",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_verge_lite",
    displayName: "Amazfit Verge Lite",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_x",
    displayName: "Amazfit X",
  },
  {
    family: "huami_legacy",
    modelId: "zepp_e",
    displayName: "Zepp E",
  },
  {
    family: "huami_legacy",
    modelId: "amazfit_band_5",
    displayName: "Amazfit Band 5",
  },
  {
    family: "huami_legacy",
    modelId: "xiaomi_mi_band_2",
    displayName: "Mi Band 2",
  },
  {
    family: "huami_legacy",
    modelId: "xiaomi_mi_band_2_hrx",
    displayName: "Mi Band 2 HRX",
  },
  {
    family: "huami_legacy",
    modelId: "xiaomi_mi_band_3",
    displayName: "Mi Band 3",
  },
  {
    family: "huami_legacy",
    modelId: "xiaomi_mi_band_4",
    displayName: "Mi Smart Band 4",
  },
  {
    family: "huami_legacy",
    modelId: "xiaomi_mi_band_5",
    displayName: "Mi Smart Band 5",
  },
  {
    family: "huami_legacy",
    modelId: "xiaomi_mi_band_6",
    displayName: "Mi Smart Band 6",
  },
  // Moyoung watches (Issue #426): heart-rate history and sleep sessions only.
  // Moyoung reports steps as a single daily total, which the exact-minute
  // `steps` record type cannot represent, so steps are deliberately NOT mapped
  // in v1 (see the issue comment). The native lane owns the BLE protocol; these
  // rows only carry the shared identity vocabulary. None are transport-validated
  // yet.
  {
    family: "moyoung",
    modelId: "moyoung_advan_watch_se1_ai",
    displayName: "Moyoung Advan Watch SE1 AI",
  },
  {
    family: "moyoung",
    modelId: "moyoung_alt_vibe",
    displayName: "Moyoung Alt Vibe",
  },
  {
    family: "moyoung",
    modelId: "moyoung_bettdow_fb051",
    displayName: "Moyoung Bettdow FB051",
  },
  {
    family: "moyoung",
    modelId: "moyoung_blackview_r60",
    displayName: "Moyoung Blackview R60",
  },
  {
    family: "moyoung",
    modelId: "moyoung_c20",
    displayName: "Moyoung C20",
  },
  {
    family: "moyoung",
    modelId: "moyoung_c20_pro",
    displayName: "Moyoung C20 Pro",
  },
  {
    family: "moyoung",
    modelId: "moyoung_colmi_i28_ultra",
    displayName: "Moyoung Colmi I28 Ultra",
  },
  {
    family: "moyoung",
    modelId: "moyoung_colmi_p76",
    displayName: "Moyoung Colmi P76",
  },
  {
    family: "moyoung",
    modelId: "moyoung_colmi_p80",
    displayName: "Moyoung Colmi P80",
  },
  {
    family: "moyoung",
    modelId: "moyoung_colmi_p81",
    displayName: "Moyoung Colmi P81",
  },
  {
    family: "moyoung",
    modelId: "moyoung_colmi_v72",
    displayName: "Moyoung Colmi V72",
  },
  {
    family: "moyoung",
    modelId: "moyoung_colmi_v73",
    displayName: "Moyoung Colmi V73",
  },
  {
    family: "moyoung",
    modelId: "moyoung_colmi_v76",
    displayName: "Moyoung Colmi V76",
  },
  {
    family: "moyoung",
    modelId: "moyoung_colmi_v89",
    displayName: "Moyoung Colmi V89",
  },
  {
    family: "moyoung",
    modelId: "moyoung_fireboltt_069",
    displayName: "Moyoung Fireboltt 069",
  },
  {
    family: "moyoung",
    modelId: "moyoung_fireboltt_ninja_phantom",
    displayName: "Moyoung Fireboltt Ninja Phantom",
  },
  {
    family: "moyoung",
    modelId: "moyoung_fireboltt_talk",
    displayName: "Moyoung Fireboltt Talk",
  },
  {
    family: "moyoung",
    modelId: "moyoung_garett_eva",
    displayName: "Moyoung Garett Eva",
  },
  {
    family: "moyoung",
    modelId: "moyoung_hc96",
    displayName: "Moyoung HC96",
  },
  {
    family: "moyoung",
    modelId: "moyoung_itech_active_3",
    displayName: "Moyoung iTech Active 3",
  },
  {
    family: "moyoung",
    modelId: "moyoung_ksix_venture",
    displayName: "Moyoung KSIX Venture",
  },
  {
    family: "moyoung",
    modelId: "moyoung_kt80",
    displayName: "Moyoung KT80",
  },
  {
    family: "moyoung",
    modelId: "moyoung_kw19_b",
    displayName: "Moyoung KW19 B",
  },
  {
    family: "moyoung",
    modelId: "moyoung_l70",
    displayName: "Moyoung L70",
  },
  {
    family: "moyoung",
    modelId: "moyoung_misirun_c17",
    displayName: "Moyoung Misirun C17",
  },
  {
    family: "moyoung",
    modelId: "moyoung_mt55",
    displayName: "Moyoung MT55",
  },
  {
    family: "moyoung",
    modelId: "moyoung_p22b1",
    displayName: "Moyoung P22B1",
  },
  {
    family: "moyoung",
    modelId: "moyoung_r50_pro",
    displayName: "Moyoung R50 Pro",
  },
  {
    family: "moyoung",
    modelId: "moyoung_rainbuvvy_t97",
    displayName: "Moyoung Rainbuvvy T97",
  },
  {
    family: "moyoung",
    modelId: "moyoung_viran_c29",
    displayName: "Moyoung Viran C29",
  },
  {
    family: "moyoung",
    modelId: "moyoung_zl02d",
    displayName: "Moyoung ZL02D",
  },
  // FitPro bands and watches (Issue #426): 15-minute step buckets, stage-start
  // sleep records and realtime heart rate. The native lane owns the BLE
  // protocol; these rows only carry the shared identity vocabulary. The family
  // covers every `vendor: fitpro` entry in the upstream device catalog (13 at
  // the pinned revision), including the two ColaCao models whose coordinator
  // disables heart-rate requests. None are transport-validated yet.
  {
    family: "fitpro",
    modelId: "colacao_2021",
    displayName: "ColaCao 2021",
  },
  {
    family: "fitpro",
    modelId: "colacao_2023",
    displayName: "ColaCao 2023",
  },
  {
    family: "fitpro",
    modelId: "fitpro_braz7harry",
    displayName: "FitPro BRAZ/7HARRY",
  },
  {
    family: "fitpro",
    modelId: "fitpro_d13_116plus",
    displayName: "FitPro D13 116Plus",
  },
  {
    family: "fitpro",
    modelId: "fitpro_fit_1900",
    displayName: "FitPro Fit1900",
  },
  {
    family: "fitpro",
    modelId: "fitpro_lh716",
    displayName: "FitPro LH716",
  },
  {
    family: "fitpro",
    modelId: "fitpro_m4",
    displayName: "FitPro M4",
  },
  {
    family: "fitpro",
    modelId: "fitpro_m6",
    displayName: "FitPro M6",
  },
  {
    family: "fitpro",
    modelId: "fitpro_series_11",
    displayName: "FitPro Series 11",
  },
  {
    family: "fitpro",
    modelId: "fitpro_sunset_6",
    displayName: "FitPro Sunset 6",
  },
  {
    family: "fitpro",
    modelId: "fitpro_watch_7",
    displayName: "FitPro Watch 7",
  },
  {
    family: "fitpro",
    modelId: "fitpro_y68",
    displayName: "FitPro Y68",
  },
  {
    family: "fitpro",
    modelId: "fitpro_ybw_05",
    displayName: "FitPro YBW-05",
  },
];

export function findDirectDeviceModel(
  identity: DirectDeviceIdentity,
): DirectDeviceModelDescriptor | undefined {
  return DIRECT_DEVICE_MODELS.find(
    (model) => model.family === identity.family && model.modelId === identity.modelId,
  );
}
export function isDirectDeviceIdentity(value: unknown): value is DirectDeviceIdentity {
  if (!value || typeof value !== "object") return false;
  const identity = value as Partial<DirectDeviceIdentity>;
  return (
    typeof identity.family === "string" &&
    typeof identity.modelId === "string" &&
    findDirectDeviceModel(identity as DirectDeviceIdentity) !== undefined
  );
}
export function supportsDirectDeviceSteps(identity: DirectDeviceIdentity): boolean {
  return identity.family === "zepp_os" && identity.modelId === "amazfit_helio_strap";
}
