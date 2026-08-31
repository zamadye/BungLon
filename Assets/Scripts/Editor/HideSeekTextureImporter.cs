// ============================================================================
//  HideSeekTextureImporter.cs   (Editor)
//  Mengatur otomatis import setting untuk hasil pipeline aset AI di
//  Assets/Art/HideSeek/**, supaya:
//    - tile tanah  -> Read/Write ENABLED (WAJIB: CamouflageHelper membaca pixel
//                     lewat GetPixelBilinear untuk skill "Match Color")
//    - prop/karakter -> sprite Tight + PPU 128 (1 sprite 128px = 1 unit dunia)
//    - background  -> bukan sprite, tidak perlu readable (hemat RAM)
//  Tidak ada yang perlu disetel manual lagi setelah menaruh PNG di folder itu.
//  (Folder Assets/Resources/HideSeek/Sprites sengaja TIDAK disentuh - itu aset
//   placeholder buatan Setup Tool yang sudah punya setting sendiri.)
// ============================================================================
#if UNITY_EDITOR
using UnityEditor;
using UnityEngine;

namespace HideSeek.EditorTools
{
    public class HideSeekTextureImporter : AssetPostprocessor
    {
        private const string RootFolder = "Assets/Art/HideSeek";

        private void OnPreprocessTexture()
        {
            string path = assetPath.Replace('\\', '/');
            if (!path.StartsWith(RootFolder)) return;

            var ti = assetImporter as TextureImporter;
            if (ti == null) return;

            bool isTile = path.Contains("/Tiles/");
            bool isBackground = path.Contains("/Background/");
            bool isIcon = path.Contains("/Icons/");

            ti.textureType = isBackground ? TextureImporterType.Default : TextureImporterType.Sprite;
            ti.spriteImportMode = SpriteImportMode.Single;
            ti.spriteAlignment = (int)SpriteAlignment.Center;
            ti.spriteMeshType = isTile ? SpriteMeshType.FullRect : SpriteMeshType.Tight;

            // PPU: tile 128px = 1x1 unit (sama seperti ukuran BoxCollider2D tile peta).
            ti.spritePixelsPerUnit = isIcon ? 100f : 128f;

            ti.alphaIsTransparency = !isTile && !isBackground;
            ti.alphaSource = TextureImporterAlphaSource.FromInput;
            ti.premultiplyAlpha = false;

            ti.mipmapEnabled = isBackground;                 // dunia 2D top-down: tanpa mipmap
            ti.filterMode = isTile ? FilterMode.Bilinear : FilterMode.Bilinear;
            ti.wrapMode = isTile ? TextureWrapMode.Repeat : TextureWrapMode.Clamp;
            ti.npotScale = TextureImporterNPOTScale.None;
            ti.sRGBTexture = true;
            ti.maxTextureSize = isBackground ? 2048 : (isIcon ? 256 : 256);

            // Hanya tekstur yang disampling CPU yang perlu salinan readable.
            ti.isReadable = isTile;
            ti.ignoreMasterTextureLimit = false;
            ti.crunchedCompression = false;
            ti.textureCompression = isBackground
                ? TextureImporterCompression.Uncompressed     // background: kualitas penuh, 1 buah saja
                : TextureImporterCompression.Compressed;

            EditorUtility.SetDirty(ti);
        }
    }
}
#endif
