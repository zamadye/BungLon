// ============================================================================
//  HideSeekPrefabs.cs
//  Satu-satunya tempat penamaan path prefab yang di-INstantiate lewat network
//  (PhotonNetwork.Instantiate memakai NAMANYA, jadi nama harus identik di semua
//  klien). Jika field di NetworkManager belum di-assign, PrefabLibrary
//  otomatis mengambil dari Resources/HideSeek/<name> agar project langsung jalan.
// ============================================================================
using UnityEngine;

namespace HideSeek.Core
{
    public static class HideSeekPrefabs
    {
        /// <summary>
        /// Prefab pemain (punya PhotonView + PlayerController + PlayerCombat + skills).
        /// File prefab WAJIB berada di ROOT folder Resources: Assets/Resources/PlayerNetworked.prefab
        /// (PhotonNetwork.Instantiate memakai Resources.Load("PlayerNetworked") yang tidak membaca sub-folder).
        /// </summary>
        public const string Player = "PlayerNetworked";

        /// <summary>Nama alternatif yang juga diterima bila kamu menamai prefab-nya "Player".</summary>
        public const string PlayerAlias = "Player";

        /// <summary>Ring visual Sonic Blast.</summary>
        public const string SonicRing = "SonicBlastRing";

        /// <summary>Peta placeholder (dipakai hanya bila scene belum punya ground).</summary>
        public const string PlaceholderMap = "MapPlaceholder";
    }

    /// <summary>
    /// Resolver prefab sederhana: Inspector -> Resources. Dipanggil di Host saat spawn
    /// dan di semua klien, sehingga tidak perlu scene setup manual untuk playtest pertama.
    /// </summary>
    public static class PrefabLibrary
    {
        /// <summary>Sub-folder cadangan di dalam Resources (asset non-network: sprite, PropDatabase).</summary>
        public const string ResourcesFolder = "HideSeek/";

        /// <summary>
        /// PUN2 (DefaultPool) memuat prefab jaringan dengan Resources.Load(NAMA_BENAR) ->
        /// file HARUS berada di ROOT folder Resources (Assets/Resources/PlayerNetworked.prefab),
        /// TIDAK boleh di sub-folder. Karena itu kita coba beberapa lokasi agar project
        /// yang sudah terlanjur memakai sub-folder tetap jalan.
        /// </summary>
        private static readonly string[] Prefixes = { "", ResourcesFolder, "PhotonPrefab/" };

        /// <summary>Load asset dari Resources dengan mencoba semua prefix yang diizinkan.</summary>
        public static T Load<T>(string resourceName) where T : Object
        {
            if (string.IsNullOrEmpty(resourceName)) return null;
            for (int i = 0; i < Prefixes.Length; i++)
            {
                T found = Resources.Load<T>(Prefixes[i] + resourceName);
                if (found != null) return found;
            }
            return null;
        }

        /// <summary>
        /// Kembalikan <paramref name="assigned"/> bila terisi; kalau kosong, load dari Resources.
        /// Untuk prefab pemain juga dicoba nama alternatif "Player" (sesuai checklist manual).
        /// </summary>
        public static GameObject Resolve(GameObject assigned, string resourceName, bool logError = true)
        {
            if (assigned != null) return assigned;

            GameObject go = Load<GameObject>(resourceName);

            // Prefab pemain kadang dinamai "Player" oleh user -> terima dua-duanya.
            if (go == null && resourceName == HideSeekPrefabs.Player)
                go = Load<GameObject>(HideSeekPrefabs.PlayerAlias);

            if (go == null && logError)
            {
                Debug.LogError("[HideSeek] Prefab '" + resourceName + "' tidak ditemukan.\n" +
                               "  - field Inspector kosong / belum di-assign, dan\n" +
                               "  - tidak ada Assets/Resources/" + resourceName + ".prefab (ROOT Resources, bukan sub-folder!).\n" +
                               "    PhotonNetwork.Instantiate hanya mencari prefab lewat nama file di root folder Resources.\n" +
                               "Solusi: jalankan menu HideSeek > Setup > 1. Generate Placeholder Assets, " +
                               "atau pindahkan prefab ke Assets/Resources/.");
            }
            return go;
        }

        /// <summary>
        /// Nama yang dipakai PhotonNetwork.Instantiate: nama FILE prefab (bukan nama instance di Hierarchy).
        /// Semua klien harus punya file dengan nama yang sama persis.
        /// </summary>
        public static string NetName(GameObject prefab)
        {
            if (prefab == null) return null;
            string n = prefab.name;
            // Hierarchy kadang memberi "(Clone)" - buang agar lookup tidak gagal.
            int clone = n.IndexOf("(Clone)");
            if (clone > 0) n = n.Substring(0, clone).Trim();
            return n;
        }
    }
}
