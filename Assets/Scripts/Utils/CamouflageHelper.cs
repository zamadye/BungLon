// ============================================================================
//  CamouflageHelper.cs  (SCRIPT #8)
//  Utility untuk mengambil RATA-RATA warna di bawah karakter (skill "Match Color").
//
//  Cara kerja:
//    1. Raycast 2D ke bawah (Physics2D.Raycast) untuk menemukan collider tanah/prop.
//    2. Ambil SpriteRenderer pada collider itu -> sprite, textureRect, tint.
//    3. Sampel grid NxN (default 5x5) pada area world +/- sampleArea, dikonversi
//       ke UV tekstur (memperhitungkan atlas/sliced sprite), lalu dirata-ratakan
//       dengan bobot alpha (pixel transparan diabaikan).
//    4. Hasil dirata-ratakan di cache per-SpriteRenderer (TIDAR per frame).
//
//  PERSYARATAN:
//    * Tekstur tanah HARUS dicentang "Read/Write Enabled" (Import Settings).
//      Bila tidak readable, helper jatuh ke fallback = SpriteRenderer.color (tint),
//      sehingga warna rata-rata tile atlas tetap masuk akal untuk palet sederhana.
//    * Collider tanah berada di layer groundLayerMask (default layer 6 = Ground).
//
//  PENTING: panggil RequestAverageColor() hanya SAAT SKILL DIPAKAI (bukan tiap frame).
// ============================================================================
using System.Collections.Generic;
using UnityEngine;

namespace HideSeek.Utils
{
    [DisallowMultipleComponent]
    public class CamouflageHelper : MonoBehaviour
    {
        [Header("Raycast (ke bawah karakter)")]
        [Tooltip("Layer yang dianggap tanah/permukaan. Default layer 6 (Ground).")]
        public LayerMask groundLayerMask = 1 << HideSeek.Core.HideSeekConstants.GroundLayerIndex;

        [Tooltip("Panjang ray ke bawah (meter).")]
        public float rayDistance = 3.0f;

        [Tooltip("Titik mulai ray dinaikkan sejauh ini dari posisi karakter (agar tile di atas tidak ikut kena).")]
        public float rayStartLift = 0.45f;

        [Tooltip("Offset Y titik kaki (di bawah pusat sprite). Di peta top-down 2D, OverlapPoint di kaki = sumber utama sampling warna.")]
        public float feetOffsetY = -0.4f;

        [Tooltip("Trigger (mis. area prop) ikut dianggap permukaan?")]
        public QueryTriggerInteraction triggerMode = QueryTriggerInteraction.Collide;

        [Header("Sampling warna")]
        [Tooltip("Jumlah sampel per sisi (1..9). 5 = 25 sampel.")]
        [Range(1, 9)] public int samplesPerSide = 5;

        [Tooltip("Radius area tanah (meter) yang dirata-ratakan di sekitar kaki karakter.")]
        public float sampleArea = 0.6f;

        [Tooltip("Kalau true, semua collider ground yang overlap dengan lingkaran ini ikut dirata-ratakan.")]
        public bool blendMultipleColliders = true;

        [Tooltip("Radius blend saat blendMultipleColliders = true.")]
        public float blendRadius = 0.45f;

        [Tooltip("true = selalu hitung ulang (debug), false = pakai cache per renderer.")]
        public bool disableCache = false;

        [Tooltip("Tulis log detail ke Console (matikan di build release).")]
        public bool verboseLogging;

        /// <summary>Warna hasil sampling terakhir (untuk UI preview).</summary>
        public Color LastSampledColor { get; private set; } = Color.white;

        // --------------------------- CACHE ----------------------------------
        // Kunci: instanceID SpriteRenderer. Nilai: rata-rata warna SUDAH termasuk tint.
        private static readonly Dictionary<int, Color> avgCache = new Dictionary<int, Color>(128);
        private static readonly Dictionary<int, Sprite> avgCacheSprite = new Dictionary<int, Sprite>(128);

        // =========================== PUBLIC API ===============================

        /// <summary>
        /// Ambil warna rata-rata tanah tepat di bawah <paramref name="worldPos"/>.
        /// Return false bila tidak ada tanah di bawah (hider berdiri di jurang/di atas prop non-ground).
        /// </summary>
        public bool TryGetGroundColor(Vector2 worldPos, out Color averageColor)
        {
            Collider2D ignored;
            return RequestAverageColor(worldPos, out averageColor, out ignored);
        }

        /// <summary>
        /// Versi lengkap: mengembalikan warna + collider yang menjadi sumber sampel.
        /// Dipanggil HiderSkill saat casting "Match Color".
        /// </summary>
        public bool RequestAverageColor(Vector2 worldPos, out Color color, out Collider2D groundHit)
        {
            color = Color.white;
            groundHit = null;

            // (A) SUMBER UTAMA: OverlapPoint di posisi kaki. Pada peta top-down 2D semua tile
            //     sejajar pada satu bidang, jadi titik kaki = tile yang benar-benar di bawah
            //     karakter (raycast vertikal bisa salah mengambil tile di atasnya).
            Vector2 feet = new Vector2(worldPos.x, worldPos.y + feetOffsetY);
            groundHit = Physics2D.OverlapPoint(feet, groundLayerMask, triggerMode);

            // (B) FALLBACK sesuai spesifikasi: Raycast 2D ke bawah - berguna bila tanah punya
            //     beberapa lapisan collider (mis. panggung/atap) atau tile lebih kecil dari karakter.
            if (groundHit == null)
            {
                Vector2 origin = new Vector2(worldPos.x, worldPos.y + rayStartLift);
                RaycastHit2D hit = Physics2D.Raycast(origin, Vector2.down, rayDistance, groundLayerMask, triggerMode);
                if (hit) groundHit = hit.collider;
            }

            if (groundHit == null)
            {
                if (verboseLogging) Debug.Log("[Camo] Tidak ada layer Ground di kaki maupun di bawah raycast.", this);
                return false;
            }

            if (!blendMultipleColliders)
            {
                if (!TryAverageCollider(groundHit, worldPos, out color)) return false;
                LastSampledColor = color;
                return true;
            }

            // Rata-ratakan semua ground yang overlap di sekitar kaki (jahitan antar tile).
            Collider2D[] cols = Physics2D.OverlapCircleAll(feet, blendRadius, groundLayerMask, triggerMode);
            float r = 0f, g = 0f, b = 0f, w = 0f;
            if (cols != null && cols.Length > 0)
            {
                for (int i = 0; i < cols.Length; i++)
                {
                    Color c;
                    if (!TryAverageCollider(cols[i], worldPos, out c)) continue;
                    float weight = Mathf.Max(0.01f, cols[i].bounds.size.x * cols[i].bounds.size.y);
                    r += c.r * weight; g += c.g * weight; b += c.b * weight; w += weight;
                }
            }
            if (w <= 0.0001f)
            {
                // Fallback minimal: gunakan collider hasil raycast.
                if (!TryAverageCollider(groundHit, worldPos, out color)) return false;
            }
            else
            {
                color = new Color(r / w, g / w, b / w, 1f);
            }

            LastSampledColor = color;
            return true;
        }

        /// <summary>Panggil saat mengganti/membongkar map agar cache tidak basi.</summary>
        public static void ClearCache()
        {
            avgCache.Clear();
            avgCacheSprite.Clear();
        }

        /// <summary>Bersihkan cache untuk satu renderer (dipanggil bila sprite tanah diganti runtime).</summary>
        public static void Invalidate(SpriteRenderer sr)
        {
            if (sr == null) return;
            int key = sr.GetInstanceID();
            avgCache.Remove(key);
            avgCacheSprite.Remove(key);
        }

        /// <summary>Uji cepat: apakah warna <paramref name="a"/> dan <paramref name="b"/> mirip (untuk skor camo).</summary>
        public static bool ColorsMatch(Color a, Color b, float tolerance = 0.18f)
        {
            float dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
            return Mathf.Sqrt(dr * dr + dg * dg + db * db) <= tolerance;
        }

        // =========================== INTERNALS ================================

        /// <summary>Rata-rata warna pada satu collider ground di sekitar <paramref name="worldPos"/>.</summary>
        private bool TryAverageCollider(Collider2D col, Vector2 worldPos, out Color result)
        {
            result = Color.white;
            if (col == null) return false;

            SpriteRenderer sr = col.GetComponent<SpriteRenderer>();
            if (sr == null) sr = col.GetComponentInChildren<SpriteRenderer>();
            if (sr == null) return false;                       // Tilemap / mesh tanpa sprite -> skip

            Sprite sp = sr.sprite;
            Color tint = sr.color;                              // tint = "warna dasar" artistik tile

            // Bila sprite tidak punya tekstur (atlas rusak) -> cukup pakai tint.
            if (sp == null || sp.texture == null)
            {
                result = tint;
                return true;
            }

            Texture2D tex = sp.texture;
            if (!tex.isReadable)
            {
                // Tidak bisa membaca pixel: fallback ke tint (masih bagus untuk tile palet solid).
                if (verboseLogging)
                    Debug.Log("[Camo] Tekstur '" + tex.name + "' tidak Read/Write -> fallback tint.", this);
                result = tint;
                return true;
            }

            int key = sr.GetInstanceID();
            Sprite cachedSp;
            Color cached;
            if (!disableCache && avgCache.TryGetValue(key, out cached) &&
                avgCacheSprite.TryGetValue(key, out cachedSp) && cachedSp == sp)
            {
                result = cached;
                return true;
            }

            // Rect sprite di dalam tekstur -> UV, lalu konversi area dunia ke UV.
            Rect px = sp.textureRect;
            Vector2 texSize = new Vector2(Mathf.Max(1, tex.width), Mathf.Max(1, tex.height));
            Vector2 uvOrigin = new Vector2(px.x / texSize.x, px.y / texSize.y);
            Vector2 uvSize = new Vector2(px.width / texSize.x, px.height / texSize.y);

            // Bounds sprite dalam world (termasuk scale) -> lebar satu sprite dalam world unit.
            Vector3 lossy = sr.transform.lossyScale;
            float worldW = Mathf.Max(0.0001f, Mathf.Abs(sp.bounds.size.x * lossy.x));
            float worldH = Mathf.Max(0.0001f, Mathf.Abs(sp.bounds.size.y * lossy.y));

            Vector2 pivotWorld = sr.transform.TransformPoint(sp.bounds.center);
            Vector2 local = worldPos - pivotWorld;

            float baseU = Mathf.Clamp01((local.x / worldW) + 0.5f);
            float baseV = Mathf.Clamp01((local.y / worldH) + 0.5f);
            float radU = Mathf.Clamp01(sampleArea / worldW);
            float radV = Mathf.Clamp01(sampleArea / worldH);

            int n = Mathf.Max(1, samplesPerSide);
            float r = 0f, g = 0f, b = 0f, wsum = 0f;

            for (int iy = 0; iy < n; iy++)
            {
                float fv = (n == 1) ? baseV
                    : Mathf.Clamp01(baseV - radV + (2f * radV) * (iy / (float)(n - 1)));
                for (int ix = 0; ix < n; ix++)
                {
                    float fu = (n == 1) ? baseU
                        : Mathf.Clamp01(baseU - radU + (2f * radU) * (ix / (float)(n - 1)));

                    // UV akhir di dalam tekstur (memperhitungkan posisi sprite di atlas).
                    Vector2 uv = uvOrigin + new Vector2(fu * uvSize.x, fv * uvSize.y);
                    Color c = tex.GetPixelBilinear(uv.x, uv.y);
                    if (c.a <= 0.01f) continue;

                    r += c.r * c.a; g += c.g * c.a; b += c.b * c.a; wsum += c.a;
                }
            }

            Color avg = (wsum > 0.0001f) ? new Color(r / wsum, g / wsum, b / wsum, 1f) : Color.white;
            // Warna yang dilihat pemain = tekstur * tint, jadi hasil akhir juga dikali tint.
            result = new Color(avg.r * tint.r, avg.g * tint.g, avg.b * tint.b, 1f);

            if (!disableCache)
            {
                avgCache[key] = result;
                avgCacheSprite[key] = sp;
            }
            return true;
        }

        /// <summary>Gizmos di Scene view: garis raycast + lingkaran area sampling.</summary>
        private void OnDrawGizmosSelected()
        {
            Vector2 o = new Vector2(transform.position.x, transform.position.y + feetOffsetY);
            Gizmos.color = Color.yellow;
            Gizmos.DrawLine(o, o + Vector2.down * rayDistance);
            Gizmos.color = Color.cyan;
            Gizmos.DrawWireSphere((Vector2)transform.position, blendMultipleColliders ? blendRadius : sampleArea);
        }
    }
}
