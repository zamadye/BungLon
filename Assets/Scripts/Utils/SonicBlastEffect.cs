// ============================================================================
//  SonicBlastEffect.cs
//  Efek ring Sonic Blast: melebar dari 0 -> radius, lalu fade & hancur.
//  Tidak memakai physics (damage/slow dihitung oleh caster di SeekerSkill),
//  jadi aman dan murah untuk mobile.
// ============================================================================
using System.Collections;
using UnityEngine;

namespace HideSeek.Utils
{
    [DisallowMultipleComponent]
    public class SonicBlastEffect : MonoBehaviour
    {
        [Tooltip("Durasi animasi (detik).")]
        public float duration = 0.45f;

        [Tooltip("Radius akhir dalam unit dunia.")]
        public float radius = 5f;

        [Tooltip("Scale sprite 'ring' dianggap 1 unit = 1 meter bila true.")]
        public bool radiusIsDiameter = true;

        [Tooltip("Hancurkan GameObject setelah animasi selesai.")]
        public bool autoDestroy = true;

        [Tooltip("Warna ring (bila tidak diset lewat material, pakai SpriteRenderer.color).")]
        public Color color = new Color(1f, 0.85f, 0.2f, 0.9f);

        private SpriteRenderer sr;
        private float timer;
        private float startScale = 0.1f;

        /// <summary>Diinisiasi dari SeekerSkill. <paramref name="finalRadius"/> = radius efek.</summary>
        public void Play(float finalRadius, float animDuration)
        {
            radius = Mathf.Max(0.5f, finalRadius);
            duration = Mathf.Max(0.05f, animDuration);
            sr = GetComponent<SpriteRenderer>();
            if (sr == null) sr = GetComponentInChildren<SpriteRenderer>();

            timer = 0f;
            float endScale = radius * (radiusIsDiameter ? 2f : 1f);
            transform.localScale = Vector3.one * startScale;
            if (sr != null) sr.color = color;

            StartCoroutine(CoroutineRing(endScale));
        }

        private IEnumerator CoroutineRing(float endScale)
        {
            while (timer < duration)
            {
                timer += Time.deltaTime;
                float k = Mathf.Clamp01(timer / duration);
                float s = Mathf.Lerp(startScale, endScale, k);
                transform.localScale = new Vector3(s, s, 1f);

                if (sr != null)
                {
                    Color c = sr.color;
                    c.a = color.a * (1f - k * k);       // fade cepat di akhir
                    sr.color = c;
                }
                yield return null;
            }
            if (autoDestroy) Destroy(gameObject);
        }
    }
}
