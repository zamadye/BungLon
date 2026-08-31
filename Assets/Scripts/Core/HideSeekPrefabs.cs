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
        /// <summary>Prefab pemain (punya PhotonView + PlayerController + PlayerCombat + skills).</summary>
        public const string Player = "PlayerNetworked";

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
        /// <summary>Folder Resources (tanpa "Resources/" dan tanpa ekstensi).</summary>
        public const string ResourcesFolder = "HideSeek/";

        /// <summary>
        /// Kembalikan <paramref name="assigned"/> bila terisi; kalau kosong, load dari
        /// Resources/HideSeek/&lt;name&gt;. Mengembalikan null + log error bila tidak ada.
        /// </summary>
        public static GameObject Resolve(GameObject assigned, string resourceName, bool logError = true)
        {
            if (assigned != null) return assigned;

            GameObject go = Resources.Load<GameObject>(ResourcesFolder + resourceName);
            if (go == null && logError)
            {
                Debug.LogError("[HideSeek] Prefab '" + resourceName + "' tidak ditemukan di field Inspector " +
                               "maupun di Assets/Resources/" + ResourcesFolder + resourceName +
                               ". Jalankan menu: HideSeek > Setup > Generate Placeholder Assets.");
            }
            return go;
        }

        /// <summary>Nama yang dipakai PhotonNetwork.Instantiate (harus sama di semua klien).</summary>
        public static string NetName(GameObject prefab)
        {
            if (prefab == null) return null;
            // Jika prefab berasal dari Resources, gunakan nama file-nya (Photon cocokkan by name).
            return prefab.name;
        }
    }
}
