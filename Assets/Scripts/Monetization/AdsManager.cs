// ============================================================================
//  AdsManager.cs   (HideSeek.Monetization)
//  Wrapper REWARDED VIDEO Unity Ads untuk game HideSeek.
//
//  DESIGN: file ini WAJIB bisa dikompilasi walau package Unity Ads BELUM
//  terpasang, supaya project tidak error hanya karena belum ada SDK.
//    - SDK belum di-import          -> otomatis SIMULASI (reward diberi setelah jeda singkat)
//    - Unity Ads 3.x terpasang      -> Scripting Define Symbols: UNITY_ADS
//    - Unity Ads 4.x / 5.x          -> UNITY_ADS;UNITY_ADS_V4   (init lewat Unity Services Core)
//  Cukup centong "Simulate Ads" = false setelah SDK siap.
//
//  Android: tambahkan perizinan di Plugins/Android/AndroidManifest.xml
//    <uses-permission android:name="com.google.android.gms.permission.AD_ID"/>
//    (dan <uses-permission android:name="android.permission.INTERNET"/> sudah dibutuhkan Photon)
//  iOS: Info.plist perlu SKAdNetworkItems dari dashboard Unity Ads.
// ============================================================================
using System;
using System.Collections;
using HideSeek.Core;
using UnityEngine;
#if UNITY_ADS
using UnityEngine.Advertisements;      // Show / ShowOptions / ShowResult
#endif
#if UNITY_ADS && UNITY_ADS_V4
using Unity.Services.Core;             // Ads 4.x/5.x butuh Unity Services Core
#endif

namespace HideSeek.Monetization
{
    /// <summary>Status inisialisasi SDK (dipakai UI untuk menyembunyikan tombol reward).</summary>
    public enum AdsState { Disabled, Simulated, Initializing, Ready, Failed }

    public class AdsManager : MonoBehaviour
    {
        public static AdsManager Instance { get; private set; }

        [Header("Umum")]
        [Tooltip("Master switch. Bila false, Semua penawaran reward disembunyikan.")]
        public bool enableAds = true;

        [Tooltip("Beri reward tanpa menampilkan iklan (development / build tanpa SDK).")]
        public bool simulateAds = true;

        [Tooltip("Test mode SDK. WAJIB tetap ON saat pengembangan, matikan sebelum rilis.")]
        public bool testMode = true;

        [Header("Game ID & placement (diisi dari dashboard Unity Ads)")]
        [Tooltip("Android game id. Kosong = ambil dari Project Settings / Services.")]
        public string androidGameId = "";
        [Tooltip("iOS game id.")]
        public string iosGameId = "";
        [Tooltip("Nama placement rewarded. Kosong = placement default \"rewardedVideo\".")]
        public string rewardedPlacement = "rewardedVideo";

        [Header("Pembatas")]
        [Tooltip("Jeda minimum antar request tampil iklan (detik). SDK menolak request yang terlalu rapat.")]
        public float minSecondsBetweenShows = HideSeekConstants.AdMinGapSeconds;
        [Tooltip("Durasi simulasi iklan (detik) - hanya dipakai saat simulateAds = true.")]
        public float simulatedAdSeconds = 1.5f;

        [Tooltip("Tulis log detail (result, error, ready state).")]
        public bool verboseLogs = true;

        /// <summary>Hasil akhir setiap request (sukses/gagal) - untuk analytics sendiri.</summary>
        public event Action<bool> OnAdFinished;

        public AdsState State { get; private set; }
        public bool IsShowing { get; private set; }
        public bool IsReady { get { return State == AdsState.Ready || State == AdsState.Simulated || State == AdsState.Disabled; } }

        private float lastShowAt = -9999f;
        private Action<bool> pending;

        // ============================== BOOTSTRAP ==============================

        /// <summary>
        /// Ambil instance, membuatkannya di atas HideSeek_GameRoot bila belum ada.
        /// Dipanggil dari RewardOffers/UIManager, jadi tidak wajib ditaruh di scene.
        /// </summary>
        public static AdsManager EnsureExists()
        {
            if (Instance != null) return Instance;
            var go = new GameObject("HideSeek_AdsManager");
            DontDestroyOnLoad(go);
            return go.AddComponent<AdsManager>();
        }

        private void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(gameObject); return; }
            Instance = this;
            DontDestroyOnLoad(gameObject);
        }

        private void Start()
        {
            Initialize();
        }

        private void OnDestroy() { if (Instance == this) Instance = null; }

        // ============================== INISIALISASI ===========================

        /// <summary>
        /// Siapkan SDK. Aman dipanggil berkali-kali. Tanpa SDK (atau simulateAds=true)
        /// status langsung Simulated sehingga alur game tetap bisa diuji.
        /// </summary>
        public void Initialize()
        {
            if (!enableAds) { State = AdsState.Disabled; Log("enableAds=false -> iklan mati."); return; }

#if UNITY_ADS
            if (simulateAds) { State = AdsState.Simulated; Log("simulateAds ON -> mode simulasi."); return; }
            if (State == AdsState.Ready || State == AdsState.Initializing) return;

            State = AdsState.Initializing;
            string gameId = Application.platform == RuntimePlatform.IPhonePlayer ? iosGameId : androidGameId;
            if (string.IsNullOrEmpty(gameId))
            {
                State = AdsState.Failed;
                Debug.LogWarning("[HideSeek/Ads] Game ID kosong -> jatuh ke mode simulasi. " +
                                 "Isi androidGameId/iosGameId atau pakai Project Settings > Unity Services.");
                State = AdsState.Simulated;
                return;
            }
            try
            {
#if UNITY_ADS_V4
                // Ads 4.x / 5.x: inisialisasi dulu lewat Unity Services Core.
                StartCoroutine(CoroutineInitV4(gameId));
#else
                // Ads 3.x: initialize langsung.
                Advertisement.Initialize(gameId, testMode);
                State = AdsState.Ready;
                Log("Unity Ads 3.x siap. placement=" + rewardedPlacement);
#endif
            }
            catch (Exception e)
            {
                State = AdsState.Failed;
                Debug.LogError("[HideSeek/Ads] Initialize gagal: " + e.Message + "\n -> mode simulasi aktif.");
                State = AdsState.Simulated;
            }
#else
            State = AdsState.Simulated;
            Log("Package Unity Ads belum di-import -> SIMULASI. Reward tetap diberikan (" +
                simulatedAdSeconds + "dtk). Setelah import package + define UNITY_ADS, matikan simulateAds.");
#endif
        }

#if UNITY_ADS && UNITY_ADS_V4
        private IEnumerator CoroutineInitV4(string gameId)
        {
            var op = UnityServices.InitializeAsync();
            while (op != null && !op.IsCompleted) yield return null;
            try
            {
                Advertisement.Initialize(gameId, testMode);
                State = AdsState.Ready;
                Log("Unity Ads 4.x siap. placement=" + rewardedPlacement);
            }
            catch (Exception e)
            {
                State = AdsState.Failed;
                Debug.LogError("[HideSeek/Ads] init v4 gagal: " + e.Message);
            }
        }

#endif

        // ================================ SHOW =================================

        /// <summary>
        /// Tampilkan iklan rewarded. onResult(true) hanya bila reward benar-benar earned
        /// (pemain menonton penuh). Semua kegagalan dipanggil dengan onResult(false).
        /// </summary>
        public void ShowRewarded(Action<bool> onResult)
        {
            if (IsShowing) { Fail(onResult, "iklan sedang tampil"); return; }
            if (!enableAds) { Fail(onResult, "iklan dinonaktifkan"); return; }
            if (Time.realtimeSinceStartup - lastShowAt < minSecondsBetweenShows)
            {
                Fail(onResult, "terlalu cepat (jeda " + minSecondsBetweenShows + "dtk)");
                return;
            }
            if (pending != null) { Fail(onResult, "request lain sedang antre"); return; }

            pending = onResult;
            IsShowing = true;
            lastShowAt = Time.realtimeSinceStartup;

#if UNITY_ADS
            if (State == AdsState.Simulated) { StartCoroutine(CoroutineSimulate()); return; }
            bool ready = string.IsNullOrEmpty(rewardedPlacement) ? Advertisement.IsReady() : Advertisement.IsReady(rewardedPlacement);
            if (!ready)
            {
                StartCoroutine(CoroutineSimulate());     // belum ada fill -> jangan bikin pemain menunggu
                return;
            }
            try
            {
#if UNITY_ADS_V4
                // Ads 4.x/5.x
                var options = new ShowOptions { ResultCallback = (ShowResult r) => FinishReal(r == ShowResult.Finished) };
                if (string.IsNullOrEmpty(rewardedPlacement)) Advertisement.Show<RewardedAd>(options);
                else Advertisement.Show<RewardedAd>(rewardedPlacement, options);
#else
                // Ads 3.x
                var options = new ShowOptions { resultCallback = (ShowResult r) => FinishReal(r == ShowResult.Finished) };
                if (string.IsNullOrEmpty(rewardedPlacement)) Advertisement.Show(options);
                else Advertisement.Show(rewardedPlacement, options);
#endif
                AudioListener.pause = true;              // jangan biarkan SFX menumpuk di belakang iklan
            }
            catch (Exception e)
            {
                AudioListener.pause = false;
                Debug.LogError("[HideSeek/Ads] Show gagal: " + e.Message +
                               "\n -> cek versi package. Untuk Unity Ads 4.x/5.x tambahkan define UNITY_ADS_V4.");
                StartCoroutine(CoroutineSimulate());     // jangan mengunci pemain tanpa kesempatan reward
            }
#else
            StartCoroutine(CoroutineSimulate());
#endif
        }

        /// <summary>Titik akhir callback SDK: lepas pause lalu serahkan hasil.</summary>
        private void FinishReal(bool earned)
        {
            AudioListener.pause = false;
            IsShowing = false;
            Log("hasil iklan: " + (earned ? "FINISHED -> reward DIBERIKAN" : "tidak lengkap -> reward TIDAK"));
            Deliver(earned);
        }

        private IEnumerator CoroutineSimulate()
        {
            Log("Simulasi iklan " + simulatedAdSeconds + "dtk...");
            yield return new WaitForSecondsRealtime(Mathf.Max(0.1f, simulatedAdSeconds));
            IsShowing = false;
            Deliver(true);
        }

        private void Deliver(bool earned)
        {
            var cb = pending;
            pending = null;
            if (cb != null) cb(earned);
            if (OnAdFinished != null) OnAdFinished(earned);
        }

        private void Fail(Action<bool> cb, string why)
        {
            Log("request ditolak: " + why);
            if (cb != null) cb(false);
        }

        private void Log(string m) { if (verboseLogs) Debug.Log("[HideSeek/Ads] " + m); }
    }
}
