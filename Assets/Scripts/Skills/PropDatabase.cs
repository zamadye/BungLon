// ============================================================================
//  PropDatabase.cs   (SCRIPT #9 - wajib)
//  ScriptableObject berisi daftar prop yang boleh dipakai skill "Prop Swap".
//  Buat asset: Assets/Prefabs > kanan klik > Create > HideSeek > Prop Database.
//
//  ID prop (byte) yang dikirim lewat network -> semua klien WAJIB punya database
//  dengan ID yang sama (prefab boleh beda asal ukurannya mirip).
// ============================================================================
using System;
using HideSeek.Core;
using UnityEngine;

namespace HideSeek.Skills
{
    [CreateAssetMenu(fileName = "PropDatabase", menuName = "HideSeek/Prop Database", order = 0)]
    public class PropDatabase : ScriptableObject
    {
        [Serializable]
        public class PropEntry
        {
            [Tooltip("ID yang dikirim lewat network. Harus unik & sama di semua build (0 = Meja, 1 = Kursi, 2 = Pot).")]
            public byte id;

            [Tooltip("Nama yang ditampilkan ke pemain saat berubah jadi prop.")]
            public string displayName = "Prop";

            [Tooltip("Prefab prop (harus punya Collider2D + SpriteRenderer). Kosongkan -> otomatis load Resources/HideSeek/Prop_<id>.")]
            public GameObject prefab;

            [Tooltip("Skala saat dipasang di posisi hider.")]
            public Vector3 localScale = Vector3.one;

            [Tooltip("Tint visual (dipakai bila prefab hanya satu sprite putih).")]
            public Color tintColor = Color.white;

            [Tooltip("true = prop terlihat 'menyatu' dengan tanah saat camo (warna dasar tetap).")]
            public bool keepPlayerSorting = true;

            /// <summary>Resolusi prefab: Inspector -> Resources fallback.</summary>
            public GameObject ResolvePrefab()
            {
                if (prefab != null) return prefab;
                var go = PrefabLibrary.Load<GameObject>("Prop_" + id);
                return go;
            }
        }

        [Header("Daftar prop (spesifikasi: meja, kursi, pot bunga)")]
        public PropEntry[] props = new PropEntry[]
        {
            new PropEntry { id = 0, displayName = "Meja",     localScale = new Vector3(1.6f, 1.0f, 1f), tintColor = new Color(0.55f, 0.38f, 0.25f) },
            new PropEntry { id = 1, displayName = "Kursi",    localScale = new Vector3(0.8f, 0.9f, 1f), tintColor = new Color(0.45f, 0.33f, 0.22f) },
            new PropEntry { id = 2, displayName = "Pot Bunga", localScale = new Vector3(0.7f, 0.7f, 1f), tintColor = new Color(0.35f, 0.6f, 0.3f) }
        };

        [Header("Override durasi (0 = pakai konstanta 8 detik)")]
        [Range(0f, 30f)] public float swapDurationOverride = 0f;

        [Header("Preferensi pemilihan")]
        [Tooltip("true = prop dipilih acak, false = urut (berguna untuk debug/desain level).")]
        public bool randomize = true;

        /// <summary>Jumlah prop terdaftar.</summary>
        public int Count { get { return props != null ? props.Length : 0; } }

        /// <summary>Durasi swap efektif (detik).</summary>
        public float SwapDuration
        {
            get { return swapDurationOverride > 0f ? swapDurationOverride : HideSeekConstants.PropSwapDuration; }
        }

        /// <summary>Cari entry berdasarkan ID jaringan. Mengembalikan null bila tidak ada.</summary>
        public PropEntry Get(byte id)
        {
            if (props == null) return null;
            for (int i = 0; i < props.Length; i++)
                if (props[i] != null && props[i].id == id) return props[i];
            return null;
        }

        /// <summary>ID pertama yang punya prefab valid (fallback bila ID dari network tidak dikenal).</summary>
        public byte FallbackId()
        {
            if (props == null || props.Length == 0) return 0;
            for (int i = 0; i < props.Length; i++)
                if (props[i] != null && props[i].ResolvePrefab() != null) return props[i].id;
            return props[0] != null ? props[0].id : (byte)0;
        }

        /// <summary>
        /// Pilih prop. <paramref name="seed"/> dibuat dari actorNumber + Time.frameCount
        /// agar tiap hider mendapat prop berbeda, tapi tetap deterministik bila perlu di-replay.
        /// </summary>
        public PropEntry Pick(int seed)
        {
            if (Count == 0) return null;
            int index;
            if (randomize)
            {
                unchecked
                {
                    int h = seed * 39916801;
                    h = (h << 13) ^ h;
                    index = Mathf.Abs((h * (h * h * 15731 + 789221) + 1376312589)) % Count;
                }
            }
            else
            {
                index = Mathf.Abs(seed) % Count;
            }
            return props[index];
        }

        /// <summary>Validasi sederhana di editor (dipanggil oleh SetupTool).</summary>
        public int Validate(out string report)
        {
            var sb = new System.Text.StringBuilder();
            int missing = 0;
            for (int i = 0; i < Count; i++)
            {
                PropEntry e = props[i];
                if (e == null) { sb.AppendLine("Entry #" + i + " null"); missing++; continue; }
                if (e.ResolvePrefab() == null)
                {
                    missing++;
                    sb.AppendLine("Prop id=" + e.id + " (" + e.displayName + ") tidak punya prefab " +
                                  "dan tidak ada di Resources/HideSeek/Prop_" + e.id);
                }
            }
            report = sb.ToString();
            return missing;
        }

        /// <summary>Ambil database default (dipanggil HiderSkill saat field belum di-assign).</summary>
        public static PropDatabase LoadDefault()
        {
            var db = PrefabLibrary.Load<PropDatabase>("PropDatabase");
            return db;
        }
    }
}
