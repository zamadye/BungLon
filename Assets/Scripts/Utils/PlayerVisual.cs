// ============================================================================
//  PlayerVisual.cs
//  Pembungkus ringan untuk semua SpriteRenderer milik satu karakter.
//  Dipakai PlayerCombat (mode hantu), HiderSkill (camo / prop), SeekerSkill
//  (flash saat kena Sonic Blast) supaya tidak ada yang memanggil
//  GetComponentsInChildren() berulang kali dan supaya alpha dasar tidak hilang.
// ============================================================================
using System.Collections.Generic;
using UnityEngine;

namespace HideSeek.Utils
{
    [DisallowMultipleComponent]
    public class PlayerVisual : MonoBehaviour
    {
        [Tooltip("Transform yang berisi semua sprite karakter (child 'Visual').")]
        public Transform root;

        [Tooltip("Bila kosong, komponen SpriteRenderer dicari otomatis di root/children.")]
        public List<SpriteRenderer> renderers = new List<SpriteRenderer>(4);

        private readonly List<Color> baseColors = new List<Color>(4);
        private float baseAlpha = 1f;
        private bool captured;

        /// <summary>Alpha normal (sebelum jadi hantu).</summary>
        public float BaseAlpha { get { return baseAlpha; } }

        /// <summary>Kumpulkan renderer + simpan warna/asli alpha. Aman dipanggil 2x.</summary>
        public void Capture()
        {
            if (captured) return;
            captured = true;

            renderers.Clear();
            baseColors.Clear();

            Transform t = root != null ? root : transform;
            t.GetComponents<SpriteRenderer>(renderers);
            if (renderers.Count == 0) t.GetComponentsInChildren<SpriteRenderer>(true, renderers);

            for (int i = 0; i < renderers.Count; i++)
            {
                if (renderers[i] == null) continue;
                baseColors.Add(renderers[i].color);
            }
            baseAlpha = renderers.Count > 0 ? renderers[0].color.a : 1f;
        }

        /// <summary>Semua sprite memakai warna yang sama (dipakai camo & mati).</summary>
        public void TintAll(Color c)
        {
            Capture();
            for (int i = 0; i < renderers.Count; i++)
            {
                if (renderers[i] == null) continue;
                Color col = c;
                col.a = renderers[i].color.a;
                renderers[i].color = col;
            }
        }

        /// <summary>Ganti alpha semua sprite (mode hantu = 0.3).</summary>
        public void SetAlpha(float a)
        {
            Capture();
            for (int i = 0; i < renderers.Count; i++)
            {
                if (renderers[i] == null) continue;
                Color c = renderers[i].color;
                c.a = a;
                renderers[i].color = c;
            }
        }

        /// <summary>Kembalikan warna & alpha seperti di Inspector.</summary>
        public void ResetToBase()
        {
            Capture();
            for (int i = 0; i < renderers.Count && i < baseColors.Count; i++)
            {
                if (renderers[i] == null) continue;
                renderers[i].color = baseColors[i];
            }
        }

        /// <summary>Sembunyikan/tampilkan karakter (dipakai saat jadi prop).</summary>
        public void SetVisible(bool visible)
        {
            Capture();
            for (int i = 0; i < renderers.Count; i++)
            {
                if (renderers[i] == null) continue;
                renderers[i].enabled = visible;
            }
        }

        /// <summary>Flip visual kiri/kanan (badan sprite, bukan transform fisik -> aman untuk netcode).</summary>
        public void SetFlip(bool flipX)
        {
            Capture();
            Vector3 s = (root != null ? root : transform).localScale;
            s.x = Mathf.Abs(s.x) * (flipX ? -1f : 1f);
            (root != null ? root : transform).localScale = s;
        }

        /// <summary>Flash singkat (efek kena Sonic Blast) - dipakai via coroutine pemanggil.</summary>
        public void SetSortingLayer(string layer)
        {
            Capture();
            for (int i = 0; i < renderers.Count; i++)
            {
                if (renderers[i] != null) renderers[i].sortingLayerName = layer;
            }
        }
    }
}
