// ============================================================================
//  HudV2Theme.cs   (HUD v2 - Phase 2 blueprint, port web/ui.css ke Unity)
//  Satu-satunya sumber "token" tampilan HUD: warna (1 warna = 1 makna),
//  ukuran target sentuh, format MM:SS + status bahaya, dan gaya glass.
//  Dipakai HudV2SkillButton / HudV2DamageText / HudV2LocalBoard / setup tool,
//  dan angkanya sama dengan web (web/ui.css + web/uiKit.js) supaya kedua
//  build terasa seperti game yang sama.
//
//  Tidak ada dependensi ke TMP: proyek ini memakai UnityEngine.Text (legacy),
//  sama seperti UIManager.cs yang sudah ada.
// ============================================================================
using UnityEngine;
using UnityEngine.UI;

namespace HideSeek.UI
{
    /// <summary>Token tampilan HUD v2 (statis, tanpa state).</summary>
    public static class HudV2Theme
    {
        // ---------------- satu warna = satu makna (blueprint 2.1) -------------
        /// <summary>Hijau = Hider / aman / berhasil.</summary>
        public static readonly Color Hider = new Color32(56, 224, 138, 255);
        /// <summary>Merah = Seeker / bahaya / kerusakan.</summary>
        public static readonly Color Seeker = new Color32(255, 92, 92, 255);
        /// <summary>Biru = info netral (fase, timer normal, freeze).</summary>
        public static readonly Color Info = new Color32(56, 208, 255, 255);
        /// <summary>Kuning = peringatan (< 10 detik sisa waktu).</summary>
        public static readonly Color Warn = new Color32(255, 226, 122, 255);
        /// <summary>Emas = koin / XP / hadiah.</summary>
        public static readonly Color Gold = new Color32(255, 201, 64, 255);
        /// <summary>Teks utama di atas kaca.</summary>
        public static readonly Color Ink = new Color32(234, 243, 236, 255);
        /// <summary>Panel kaca (glassmorphism: gelap + semi-transparan).</summary>
        public static readonly Color Glass = new Color32(6, 20, 15, 178);
        /// <summary>Garis tepi kaca.</summary>
        public static readonly Color GlassEdge = new Color32(255, 255, 255, 26);

        // ---------------- ukuran & ritme -------------------------------------
        /// <summary>Target sentuh minimum (px) sesuai spesifikasi mobile-first.</summary>
        public const int MinTouch = 44;
        /// <summary>Garis tengah tombol skill (px) - sama seperti web (60px).</summary>
        public const int SkillDiameter = 60;
        /// <summary>Padding dasar UI ke tepi layar (px); ditambah safe-area.</summary>
        public const int Pad = 12;
        /// <summary>Ambang timer "perhatian" dan "genting" (detik).</summary>
        public const float TimerWarnAt = 10f;
        public const float TimerDangerAt = 5f;

        // ---------------- helper --------------------------------------------

        /// <summary>MM:SS (jam > 1 jam -> H:MM:SS). Sama seperti web uiKit.Clock.</summary>
        public static string Clock(float seconds)
        {
            if (float.IsNaN(seconds) || float.IsInfinity(seconds)) seconds = 0f;
            int s = Mathf.Max(0, Mathf.CeilToInt(seconds));
            int m = s / 60, ss = s % 60;
            if (m >= 60) return (m / 60) + ":" + (m % 60).ToString("00") + ":" + ss.ToString("00");
            return m + ":" + ss.ToString("00");
        }

        /// <summary>Warna timer: normal biru, <10 dtk kuning, <=5 dtk merah.</summary>
        public static Color TimerColor(float secondsRemaining)
        {
            if (secondsRemaining <= TimerDangerAt) return Seeker;
            if (secondsRemaining <= TimerWarnAt) return Warn;
            return Info;
        }

        /// <summary>
        /// Detak ringan saat genting (<=5 dtk): dipakai sebagai skala agar tetap terasa
        /// tanpa menambah animator (web memakai keyframe pulse).
        /// </summary>
        public static float TimerPulse(float secondsRemaining)
        {
            if (secondsRemaining > TimerDangerAt) return 1f;
            return 1f + 0.06f * Mathf.Sin(Time.unscaledTime * 9f);
        }

        /// <summary>Terapkan gaya "kaca" ke sebuah panel (Image + Outline opsional).</summary>
        public static void ApplyGlass(Image img, bool edge = true)
        {
            if (img == null) return;
            img.color = Glass;
            if (!edge) return;
            var o = img.GetComponent<Outline>();
            if (o == null) o = img.gameObject.AddComponent<Outline>();
            o.effectColor = GlassEdge;
            o.effectDistance = new Vector2(1f, -1f);
        }

        /// <summary>
        /// Font bawaan untuk Text legacy (proyek ini tidak memakai TextMeshPro) - sama seperti
        /// yang dipakai editor builder HideSeekSetupTool, dipakai juga oleh widget HUD v2.
        /// </summary>
        private static Font defaultFont;
        public static Font DefaultFont
        {
            get
            {
                if (defaultFont == null)
                {
                    try { defaultFont = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf"); }
                    catch { defaultFont = null; }
                    if (defaultFont == null)
                    {
                        try { defaultFont = Font.CreateDynamicFontFromOSFont("Arial", 16); }
                        catch { defaultFont = null; }
                    }
                }
                return defaultFont;
            }
        }

        /// <summary>Ubah alpha sebuah Color tanpa menyentuh RGB (dipakai heart/ghost).</summary>
        public static Color WithAlpha(Color c, float a)
        {
            c.a = Mathf.Clamp01(a);
            return c;
        }
    }
}
