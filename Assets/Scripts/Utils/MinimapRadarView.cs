// ============================================================================
//  MinimapRadarView.cs
//  Minimap 2D top-down: memetakan posisi pemain (world) -> koordinat UI, plus
//  lingkaran merah untuk skill Radar Seeker (durasi 1 detik).
//
//  SETUP (assign manual di Inspector):
//    viewport   : RectTransform area minimap (kotak), mis. Image "MinimapBg".
//    blipPrefab : GameObject berisi Image kecil (akan di-Instantiate per pemain).
//    radarRing  : Image merah bulat (dipakai ShowRadarPing).
//    worldBounds: Rect (x,y,w,h) batas peta dalam unit dunia. Isikan sama dengan ukuran map.
// ============================================================================
using System.Collections;
using System.Collections.Generic;
using HideSeek.Core;
using HideSeek.Players;
using UnityEngine;
using UnityEngine.UI;

namespace HideSeek.Utils
{
    [DisallowMultipleComponent]
    public class MinimapRadarView : MonoBehaviour
    {
        [Header("Referensi UI (assign manual)")]
        [Tooltip("Area minimap. Bila kosong, RectTransform objek ini dipakai.")]
        public RectTransform viewport;

        [Tooltip("Prefab blip (Image kecil, pivot 0.5). Boleh kosong -> dibuatkan otomatis.")]
        public GameObject blipPrefab;

        [Tooltip("Image lingkaran merah untuk Radar.")]
        public Image radarRing;

        [Tooltip("Durasi default ping radar (detik). Spesifikasi: 1 detik.")]
        public float radarDuration = 1.0f;

        [Header("Pemetaan koordinat")]
        [Tooltip("Batas peta dalam world unit (x min, y min, lebar, tinggi).")]
        public Rect worldBounds = new Rect(-20f, -14f, 40f, 28f);

        [Tooltip("Warna blip: [0] hider, [1] seeker, [2] mati/hantu.")]
        public Color hiderColor = new Color(0.25f, 0.75f, 1f, 0.95f);
        public Color seekerColor = new Color(1f, 0.3f, 0.3f, 0.95f);
        public Color deadColor = new Color(1f, 1f, 1f, 0.35f);

        [Tooltip("Skala blip relatif terhadap viewport (0.03 = 3% lebar minimap).")]
        [Range(0.005f, 0.2f)] public float blipScale = 0.035f;

        private readonly List<RectTransform> blips = new List<RectTransform>(12);
        private Coroutine radarRoutine;
        private Image ring;

        private void Awake()
        {
            if (viewport == null) viewport = transform as RectTransform;
            if (radarRing != null) radarRing.enabled = false;
            ring = radarRing;
        }

        private void Update()
        {
            UpdateBlips();
        }

        /// <summary>Buat/perbarui satu blip per pemain yang terdaftar. Skala 0..1 (relatif viewport).</summary>
        private void UpdateBlips()
        {
            if (viewport == null) return;

            // Hapus blip yatim (pemain keluar / objek dihancurkan).
            for (int i = blips.Count - 1; i >= 0; i--)
            {
                if (blips[i] == null) { blips.RemoveAt(i); continue; }
                if (blips[i].parent != viewport) blips[i].SetParent(viewport, false);
            }

            int index = 0;
            foreach (KeyValuePair<int, PlayerController> kv in PlayerRegistry.All)
            {
                PlayerController pc = kv.Value;
                if (pc == null) continue;

                RectTransform rt = EnsureBlip(index);
                if (rt == null) break;

                Vector2 pos = MapWorldToUi(pc.NetPosition);
                rt.anchoredPosition = pos;
                rt.localScale = Vector3.one * Mathf.Max(1f, viewport.rect.width * blipScale);

                var img = rt.GetComponent<Image>();
                if (img != null)
                {
                    bool dead = pc.IsGhost || (pc.Combat != null && pc.Combat.IsDead);
                    img.color = dead ? deadColor : (pc.Role == GameRole.Seeker ? seekerColor : hiderColor);
                }
                index++;
            }

            // Sembunyikan blip berlebih.
            for (int i = index; i < blips.Count; i++)
                if (blips[i] != null) blips[i].gameObject.SetActive(false);
        }

        /// <summary>Blip ke-<paramref name="i"/> (pool sederhana).</summary>
        private RectTransform EnsureBlip(int i)
        {
            while (blips.Count <= i)
            {
                GameObject go = blipPrefab != null
                    ? (GameObject)Instantiate(blipPrefab, viewport)
                    : new GameObject("blip_" + blips.Count, typeof(Image));
                if (go.transform.parent != viewport) go.transform.SetParent(viewport, false);
                var rt = go.transform as RectTransform;
                if (rt != null)
                {
                    rt.anchorMin = rt.anchorMax = new Vector2(0.5f, 0.5f);
                    rt.sizeDelta = new Vector2(8, 8);
                    rt.pivot = new Vector2(0.5f, 0.5f);
                }
                var img = go.GetComponent<Image>();
                if (img == null) img = go.AddComponent<Image>();
                if (img != null) { img.sprite = null; img.type = Image.Type.Simple; }
                blips.Add(rt);
            }
            blips[i].gameObject.SetActive(true);
            return blips[i];
        }

        /// <summary>World -> koordinat anchoredPosition (pusat viewport = tengah peta).</summary>
        public Vector2 MapWorldToUi(Vector2 worldPos)
        {
            float nx = (worldPos.x - worldBounds.xMin) / Mathf.Max(0.001f, worldBounds.width);
            float ny = (worldPos.y - worldBounds.yMin) / Mathf.Max(0.001f, worldBounds.height);
            nx = Mathf.Clamp01(nx);
            ny = Mathf.Clamp01(ny);
            Rect r = viewport.rect;
            return new Vector2((nx - 0.5f) * r.width, (ny - 0.5f) * r.height);
        }

        /// <summary>
        /// Lingkaran merah 1 detik di posisi hider terdeteksi (skill Radar).
        /// Dipanggil SeekerSkill hanya di klien caster -> tidak membocorkan posisi ke musuh.
        /// </summary>
        public void ShowRadarPing(Vector2 worldPos, float duration)
        {
            if (radarRoutine != null) StopCoroutine(radarRoutine);
            radarRoutine = StartCoroutine(CoroutinePing(worldPos, Mathf.Max(0.05f, duration)));
        }

        private IEnumerator CoroutinePing(Vector2 worldPos, float duration)
        {
            EnsureRing();
            if (ring == null) yield break;

            ring.gameObject.SetActive(true);
            float t = 0f;
            float baseSize = Mathf.Max(12f, viewport != null ? viewport.rect.width * 0.18f : 40f);

            while (t < duration)
            {
                t += Time.deltaTime;
                float k = Mathf.Clamp01(t / duration);
                ring.rectTransform.anchoredPosition = MapWorldToUi(worldPos);
                float s = Mathf.Lerp(0.35f, 1.35f, k);
                ring.rectTransform.sizeDelta = new Vector2(baseSize * s, baseSize * s);
                Color c = ring.color; c.a = 1f - k; ring.color = c;
                yield return null;
            }
            ring.gameObject.SetActive(false);
        }

        /// <summary>Buat ring otomatis bila Image belum di-assign (agar build placeholder tetap berfungsi).</summary>
        private void EnsureRing()
        {
            if (ring != null) return;
            var go = new GameObject("RadarRing", typeof(Image), typeof(CanvasRenderer));
            go.transform.SetParent(viewport != null ? (Transform)viewport : transform, false);
            ring = go.GetComponent<Image>();
            ring.color = new Color(1f, 0.2f, 0.2f, 1f);
            var rt = ring.rectTransform;
            rt.anchorMin = rt.anchorMax = new Vector2(0.5f, 0.5f);
            rt.pivot = new Vector2(0.5f, 0.5f);
            ring.enabled = true;
        }
    }
}
