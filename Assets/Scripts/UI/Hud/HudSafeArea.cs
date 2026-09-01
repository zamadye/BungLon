// ============================================================================
//  HudSafeArea.cs   (HUD v2)
//  Menyesuaikan padding panel HUD dengan "poni"/notch & gesture bar.
//  Cara kerja: Screen.safeArea (pixel layar) dikonversi ke unit kanvas lewat
//  Canvas.scaleFactor, lalu dipakai untuk menggeser offsetMin/offsetMax
//  RectTransform target. Ini padanan web dari env(safe-area-inset-*) di ui.css.
//  Pasang di root zona HUD (TL, TC, TR, ML, BR) atau di satu parent yang
//  membungkus semuanya.
// ============================================================================
using UnityEngine;

namespace HideSeek.UI
{
    [DisallowMultipleComponent]
    public class HudSafeArea : MonoBehaviour
    {
        [Tooltip("RectTransform yang digeser. Kosong = RectTransform sendiri.")]
        public RectTransform target;

        [Header("Sisi yang dipengaruhi")]
        public bool applyLeft = true;
        public bool applyRight = true;
        public bool applyTop = true;
        [Tooltip("Bila false, tombol di bawah tetap nempel (mis. joystick yang sudah punya padding).")]
        public bool applyBottom = true;

        [Tooltip("Koreksi tambahan (pixel kanvas) untuk semua sisi, mis. saat notch sangat kecil.")]
        public float extraPadding = 0f;

        private Canvas canvas;
        private Rect lastSafe = new Rect(-1, -1, -1, -1);
        private Vector2Int lastScreen = Vector2Int.zero;

        private void Awake()
        {
            if (target == null) target = transform as RectTransform;
            canvas = GetComponentInParent<Canvas>();
            Apply(true);
        }

        private void OnEnable() { Apply(true); }

        private void Update()
        {
            // Murah: hitung ulang hanya bila safe area / orientasi benar-benar berubah.
            Rect sa = Screen.safeArea;
            Vector2Int now = new Vector2Int(Screen.width, Screen.height);
            if (sa != lastSafe || now != lastScreen) Apply(false);
        }

        /// <summary>Susun ulang offset sesuai safe area (dipanggil juga dari editor/play-mode).</summary>
        public void Apply(bool force)
        {
            if (target == null) return;
            if (canvas == null) canvas = GetComponentInParent<Canvas>();

            Rect sa = Screen.safeArea;
            Vector2Int now = new Vector2Int(Screen.width, Screen.height);
            if (!force && sa == lastSafe && now == lastScreen) return;
            lastSafe = sa; lastScreen = now;

            // scaleFactor = rasio pixel-layar -> unit kanvas (CanvasScaler).
            float f = canvas != null && canvas.isRootCanvas ? Mathf.Max(0.0001f, canvas.scaleFactor) : 1f;
            Vector2 min = new Vector2(sa.xMin / f, sa.yMin / f);
            Vector2 max = new Vector2((now.x - sa.xMax) / f, (now.y - sa.yMax) / f);
            float e = Mathf.Max(0f, extraPadding);

            Vector2 oMin = target.offsetMin, oMax = target.offsetMax;
            if (applyLeft) oMin.x = min.x + e;
            if (applyBottom) oMin.y = min.y + e;
            if (applyRight) oMax.x = -(max.x + e);
            if (applyTop) oMax.y = -(max.y + e);
            target.offsetMin = oMin;
            target.offsetMax = oMax;
        }
    }
}
