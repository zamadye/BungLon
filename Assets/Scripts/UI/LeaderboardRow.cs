// ============================================================================
//  LeaderboardRow.cs
//  Satu baris leaderboard (dipakai UIManager saat menampilkan hasil & skor).
//  Buat prefab baris: Image bg + 4 Text (nama, role, HP/survive, skor) dan
//  assign prefab-nya ke UIManager.leaderboardRowPrefab.
// ============================================================================
using HideSeek.Core;
using HideSeek.Game;
using UnityEngine;
using UnityEngine.UI;

namespace HideSeek.UI
{
    [DisallowMultipleComponent]
    public class LeaderboardRow : MonoBehaviour
    {
        [Header("Referensi Text (assign manual)")]
        public Text nameText;
        public Text roleText;
        public Text detailText;
        public Text scoreText;
        public Image highlight;

        /// <summary>Isi baris dari entri leaderboard yang dibangun GameManager.</summary>
        public void Fill(int rank, GameManager.LeaderboardEntry e, bool isLocalPlayer, bool highlightColor = true)
        {
            if (nameText != null) nameText.text = rank + ". " + SafeName(e.name) + (isLocalPlayer ? " (kamu)" : "");
            if (roleText != null) roleText.text = e.role == GameRole.Seeker ? "SEEKER" : "HIDER";

            if (detailText != null)
            {
                if (e.role == GameRole.Seeker)
                    detailText.text = "Tangkapan: " + e.catches;
                else
                    detailText.text = (e.alive ? "HIDUP" : "mati") + "  HP " + e.hp + "  " + (e.surviveMs / 1000) + "s";
            }

            if (scoreText != null) scoreText.text = e.score.ToString();

            if (highlight != null && highlightColor)
            {
                Color c = highlight.color;
                c.a = isLocalPlayer ? 0.35f : (rank % 2 == 0 ? 0.06f : 0.12f);
                highlight.color = c;
            }
        }

        private static string SafeName(string n)
        {
            if (string.IsNullOrEmpty(n)) return "Player";
            return n.Length > 14 ? n.Substring(0, 14) + ".." : n;
        }
    }
}
