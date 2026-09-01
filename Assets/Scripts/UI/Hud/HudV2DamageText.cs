// ============================================================================
//  HudV2DamageText.cs   (HUD v2 - "damage numbers", blueprint 4.3)
//  Angka melayang di posisi pemain: "-1" merah saat kena pukul, "+30" emas saat
//  poin, "FREEZE" biru saat skill Bekukan menyambar. Padanan web: uiKit.Fx.damage().
//  Pooling sederhana (tidak alloc per hit), digambar di atas kanvas HUD.
//
//  CARA PAKAI (semua lewat inspector, tanpa Find):
//    1. Buat GameObject "HudV2DamageText" di bawah Canvas HUD (Screen Space - Overlay).
//    2. Assign jumlah item & fontnya dibuat otomatis oleh kode (perlu DefaultFont).
//    3. Panggil dari mana saja: HudV2DamageText.Spawn(pos, "-1", HudV2Theme.Seeker).
// ============================================================================
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

namespace HideSeek.UI
{
    /// <summary>Popup angka melayang (damage/score/info) untuk HUD v2.</summary>
    [DisallowMultipleComponent]
    public class HudV2DamageText : MonoBehaviour
    {
        [Header("Isian Inspector")]
        [Tooltip("Jumlah angka yang tersedia sekaligus (dipool).")]
        [Range(6, 48)] public int poolSize = 18;
        [Tooltip("Tinggi lintang animasi dalam pixel kanvas.")]
        public float risePixels = 52f;
        [Tooltip("Umur satu angka (detik).")]
        public float lifetime = 0.85f;
        [Tooltip("Root tempat Text dibuat. Kosong = pakai transform komponen ini.")]
        public RectTransform root;
        [Tooltip("Skala font relatif (1 = 18px).")]
        [Range(0.6f, 2f)] public float fontScale = 1f;

        private class Item
        {
            public GameObject go;
            public Text text;
            public RectTransform rt;
            public float t;
            public bool busy;
            public Vector2 start;
            public float drift;
        }

        private static HudV2DamageText instance;
        private readonly List<Item> items = new List<Item>(24);
        private Canvas canvas;

        private void Awake()
        {
            instance = this;
            if (root == null) root = (RectTransform)transform;
            canvas = GetComponentInParent<Canvas>();
            Build();
        }

        private void OnDestroy() { if (instance == this) instance = null; }

        private void Build()
        {
            for (int i = items.Count; i < Mathf.Max(4, poolSize); i++)
            {
                var go = new GameObject("dmg" + i, typeof(RectTransform), typeof(Text), typeof(Outline), typeof(CanvasGroup));
                go.transform.SetParent(root, false);
                var rt = (RectTransform)go.transform;
                rt.anchorMin = rt.anchorMax = rt.pivot = new Vector2(0.5f, 0.5f);
                rt.sizeDelta = new Vector2(120f, 30f);

                var txt = go.GetComponent<Text>();
                txt.font = HudV2Theme.DefaultFont;
                txt.fontSize = Mathf.Max(12, Mathf.RoundToInt(18f * fontScale));
                txt.alignment = TextAnchor.MiddleCenter;
                txt.horizontalOverflow = HorizontalWrapMode.Overflow;
                txt.verticalOverflow = VerticalWrapMode.Overflow;
                var o = go.GetComponent<Outline>();
                o.effectColor = new Color(0f, 0f, 0f, 0.75f);
                o.effectDistance = new Vector2(1f, -1f);

                var it = new Item { go = go, text = txt, rt = rt };
                go.SetActive(false);
                items.Add(it);
            }
        }

        private void Update()
        {
            float dt = Time.unscaledDeltaTime;
            for (int i = 0; i < items.Count; i++)
            {
                Item it = items[i];
                if (!it.busy) continue;
                it.t += dt;
                float k = Mathf.Clamp01(it.t / Mathf.Max(0.05f, lifetime));
                it.rt.position = it.start + new Vector2(it.drift * k, risePixels * k);
                var cg = it.go.GetComponent<CanvasGroup>();
                if (cg != null) cg.alpha = k < 0.25f ? 1f : 1f - (k - 0.25f) / 0.75f;
                it.rt.localScale = Vector3.one * (1f + 0.35f * (1f - k));
                if (k >= 1f) { it.busy = false; it.go.SetActive(false); }
            }
        }

        /// <summary>Tampilkan satu angka di posisi dunia (kamera ortho utama) atau posisi layar.</summary>
        public static void Spawn(Vector2 worldPos, string content, Color color, bool worldSpace = true)
        {
            if (instance == null || string.IsNullOrEmpty(content)) return;
            Item it = instance.Take();
            if (it == null) return;
            Vector2 screen = worldSpace && Camera.main != null
                ? (Vector2)Camera.main.WorldToScreenPoint(worldPos)
                : worldPos;
            // posisi layar -> posisi kanvas (Overlay: 1:1; Camera/ScreenSpace-Camera: pakai WorldToLocalPoint)
            Vector2 canvasPos = screen;
            if (instance.canvas != null && instance.canvas.renderMode != RenderMode.ScreenSpaceOverlay)
            {
                RectTransform rect = instance.canvas.rootCanvas != null ? instance.canvas.rootCanvas.transform as RectTransform : null;
                if (rect != null && RectTransformUtility.ScreenPointToLocalPointInRectangle(rect, screen,
                        instance.canvas.worldCamera, out canvasPos))
                    canvasPos = rect.TransformPoint(canvasPos);
            }

            it.text.text = content;
            it.text.color = color;
            it.start = canvasPos + new Vector2(Random.Range(-10f, 10f), Random.Range(0f, 6f));
            it.drift = Random.Range(-16f, 16f);
            it.t = 0f;
            it.busy = true;
            it.go.SetActive(true);
            it.rt.position = it.start;
        }

        private Item Take()
        {
            for (int i = 0; i < items.Count; i++) if (!items[i].busy) return items[i];
            return null;                                              // pool penuh -> skip (tidak alloc)
        }

        /// <summary>Ada instance aktif? (dipakai pemanggil yang ingin fallback diam-diam)</summary>
        public static bool Available { get { return instance != null; } }
    }
}
