/** Shared direct-device identity vocabulary; data mirrors the native registries. */
export const DIRECT_DEVICE_FAMILIES = [
  "zepp_os",
  "xiaomi",
  "huawei",
  "garmin",
  "ble_gatt",
  "ble_scale",
  "colmi_ring",
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
