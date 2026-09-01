// ============================================================================
//  HudV2LocalBoard.cs   (HUD v2 - papan skor lokal, blueprint 4.4)
//  Menyimpan 10 skor terbaik di perangkat (PlayerPrefs) dan menampilkannya di
//  layar hasil / panel leaderboard. SAMA seperti web (localStorage hideseek_scores):
//  hanya kosmetik - tidak dipakai untuk membayar reward apa pun.
//
//  Format penyimpanan (satu string, hemat): "nama|skor|unixdetik;nama|skor|unixdetik;..."
//  Kunci: hideseek_scores_unity  (paritas nama dgn web: hideseek_scores)
// ============================================================================
using System.Collections.Generic;
using System.Text;
using UnityEngine;

namespace HideSeek.UI
{
    /// <summary>Rekor lokal (top-10) untuk HUD v2.</summary>
    [DisallowMultipleComponent]
    public class HudV2LocalBoard : MonoBehaviour
    {
        /// <summary>Satu baris rekor.</summary>
        public struct Entry
        {
            public string name;
            public int score;
            public long timestampSec;
        }

        /// <summary>Nama kunci PlayerPrefs (jangan dipakai untuk hal lain!).</summary>
        public const string PrefsKey = "hideseek_scores_unity";
        /// <summary>Jumlah rekor yang dipertahankan (sama seperti web).</summary>
        public const int Capacity = 10;

        [Header("Isian Inspector")]
        [Tooltip("Text tempat daftar dirender (multi-line). Boleh kosong kalau hanya mau API.")]
        public UnityEngine.UI.Text target;
        [Tooltip("Judul baris saat daftar kosong.")]
        public string emptyText = "Belum ada rekor di perangkat ini.";
        [Tooltip("Tampilkan baris pemain lokal dengan tanda penanda.")]
        public string localMark = " ←";

        private static HudV2LocalBoard instance;

        private void Awake() { instance = this; Refresh(); }
        private void OnEnable() { if (instance != this) instance = this; Refresh(); }
        private void OnDestroy() { if (instance == this) instance = null; }

        // --------------------------------- API ---------------------------------
        /// <summary>Catat skor ronde ini (dipanggil UIManager saat RESULT).</summary>
        public static void Submit(string playerName, int score)
        {
            if (score <= 0) return;
            List<Entry> list = Read();
            list.Add(new Entry
            {
                name = string.IsNullOrEmpty(playerName) ? "Player" : playerName,
                score = score,
                timestampSec = (long)(System.DateTime.UtcNow - new System.DateTime(1970, 1, 1, 0, 0, 0, System.DateTimeKind.Utc)).TotalSeconds
            });
            SortTrim(list);
            Write(list);
            if (instance != null) instance.Refresh();
        }

        /// <summary>Baca seluruh rekor (terurut: skor desc, lalu waktu asc).</summary>
        public static List<Entry> Read()
        {
            var list = new List<Entry>(Capacity);
            string raw = PlayerPrefs.GetString(PrefsKey, string.Empty);
            if (string.IsNullOrEmpty(raw)) return list;

            string[] rows = raw.Split(';');
            for (int i = 0; i < rows.Length; i++)
            {
                if (string.IsNullOrEmpty(rows[i])) continue;
                string[] c = rows[i].Split('|');
                if (c.Length < 2) continue;
                int score;
                if (!int.TryParse(c[1], out score)) continue;
                long ts = 0L;
                if (c.Length > 2) long.TryParse(c[2], out ts);
                list.Add(new Entry { name = c[0], score = score, timestampSec = ts });
                if (list.Count >= Capacity * 4) break;                 // anti string raksasa / korup
            }
            SortTrim(list);
            return list;
        }

        /// <summary>Hapus semua rekor lokal (ada tombolnya di panel Settings HUD v2).</summary>
        public static void ClearAll()
        {
            PlayerPrefs.DeleteKey(PrefsKey);
            PlayerPrefs.Save();
            if (instance != null) instance.Refresh();
        }

        /// <summary>Teks multi-baris siap tempel (dipakai juga oleh panel hasil).</summary>
        public static string RenderText(string localName, int maxRows = Capacity)
        {
            List<Entry> list = Read();
            if (list.Count == 0) return instance != null ? instance.emptyText : "-";
            var sb = new StringBuilder(list.Count * 24);
            for (int i = 0; i < list.Count && i < Mathf.Max(1, maxRows); i++)
            {
                Entry e = list[i];
                bool mine = !string.IsNullOrEmpty(localName) && e.name == localName;
                sb.Append(i + 1).Append(". ").Append(Trim(e.name)).Append("  ").Append(e.score);
                if (mine && instance != null) sb.Append(instance.localMark);
                if (i + 1 < list.Count && i + 1 < Mathf.Max(1, maxRows)) sb.Append('\n');
            }
            return sb.ToString();
        }

        /// <summary>Render ke Text yang di-assign (dipanggil otomatis saat submit/enable).</summary>
        public void Refresh()
        {
            if (target == null) return;
            string me = UIManager.Instance != null ? UIManager.Instance.LocalPlayerName : string.Empty;
            target.text = RenderText(me);
        }

        /// <summary>Ada instance di scene? (pemanggil boleh diam-diam kalau HUD v2 tidak dipakai)</summary>
        public static bool Available { get { return instance != null; } }

        /// <summary>Paksa refresh dari kode lain (mis. saat panel leaderboard dibuka).</summary>
        public static void RefreshNow() { if (instance != null) instance.Refresh(); }

        // ------------------------------- internal ------------------------------
        private static void SortTrim(List<Entry> list)
        {
            list.Sort(delegate (Entry a, Entry b)
            {
                int c = b.score.CompareTo(a.score);
                if (c != 0) return c;
                return a.timestampSec.CompareTo(b.timestampSec);      // sama skor -> lebih dulu muncul menang
            });
            while (list.Count > Capacity) list.RemoveAt(list.Count - 1);
        }

        private static void Write(List<Entry> list)
        {
            var sb = new StringBuilder(list.Count * 24);
            for (int i = 0; i < list.Count; i++)
            {
                if (i > 0) sb.Append(';');
                sb.Append(Trim(list[i].name).Replace("|", " ").Replace(";", " ")).Append('|')
                  .Append(list[i].score).Append('|').Append(list[i].timestampSec);
            }
            PlayerPrefs.SetString(PrefsKey, sb.ToString());
            PlayerPrefs.Save();
        }

        private static string Trim(string s)
        {
            if (string.IsNullOrEmpty(s)) return "Player";
            return s.Length > 14 ? s.Substring(0, 14) : s;
        }
    }
}
