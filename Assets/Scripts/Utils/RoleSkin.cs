// ============================================================================
//  RoleSkin.cs
//  Mengganti sprite karakter sesuai role: Hider = bunglon hijau, Seeker = biru
//  berhelm. Opsional - kalau komponen tidak dipasang, PlayerController tetap
//  menandai role dengan tint warna (perilaku default project).
//
//  Diisi otomatis oleh menu: HideSeek > Setup > 5. Pasang Art AI.
// ============================================================================
using HideSeek.Core;
using UnityEngine;

namespace HideSeek.Utils
{
    [DisallowMultipleComponent]
    public class RoleSkin : MonoBehaviour
    {
        [Header("Sprite (assign manual atau lewat Setup > 5)")]
        [Tooltip("Sprite saat menjadi Hider. Kosong = sprite tidak diganti.")]
        public Sprite hiderSprite;

        [Tooltip("Sprite saat menjadi Seeker.")]
        public Sprite seekerSprite;

        [Header("Penempatan")]
        [Tooltip("Anak yang berisi SpriteRenderer karakter (mis. 'Visual'). Kosong = cari di children.")]
        public Transform visualRoot;

        [Tooltip("Tinggi karakter dalam unit dunia. Sprite di-scale otomatis supaya setinggi ini.")]
        [Range(0.4f, 4f)] public float heightInUnits = 1.5f;

        [Tooltip("Urutan render karakter (harus di atas tile tanah & prop).")]
        public int sortingOrder = 10;

        /// <summary>Ada setidaknya satu sprite -> PlayerController tidak perlu men-tint warna.</summary>
        public bool Applied { get { return hiderSprite != null || seekerSprite != null; } }

        private SpriteRenderer[] renderers;
        private Sprite current;

        private void Awake()
        {
            Collect();
        }

        private void Collect()
        {
            Transform t = visualRoot != null ? visualRoot : transform;
            renderers = t.GetComponentsInChildren<SpriteRenderer>(true);
        }

        /// <summary>Pasang sprite sesuai role. Aman dipanggil berkali-kali.</summary>
        public void Apply(GameRole role)
        {
            if (!Applied) return;
            if (renderers == null || renderers.Length == 0) Collect();

            Sprite want = role == GameRole.Seeker && seekerSprite != null
                ? seekerSprite
                : (hiderSprite != null ? hiderSprite : seekerSprite);
            if (want == null || want == current) return;
            current = want;

            for (int i = 0; i < renderers.Length; i++)
            {
                if (renderers[i] == null) continue;
                renderers[i].sprite = want;
                renderers[i].sortingOrder = sortingOrder;
                renderers[i].color = Color.white;      // sprite sudah berwarna, tidak perlu tint
            }

            // Scale: tinggi sprite (dalam unit, sudah termasuk PPU) dinormalkan ke heightInUnits.
            float h = Mathf.Max(0.0001f, want.bounds.size.y);
            float s = heightInUnits / h;
            transform.localScale = new Vector3(s, s, 1f);
        }
    }
}
