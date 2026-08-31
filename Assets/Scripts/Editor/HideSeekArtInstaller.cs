// ============================================================================
//  HideSeekArtInstaller.cs   (Editor)
//  Menu: HideSeek > Setup > 5. Pasang Art AI
//
//  Memasang hasil pipeline aset (Assets/Art/HideSeek/**, lihat Tools/
//  hideseek_art_postprocess.py) ke prefab & scene yang sudah ada:
//    - PlayerNetworked.prefab : sprite Visual = Chameleon_Hider + RoleSkin (hider/seeker)
//    - Prop_0..3.prefab       : sprite per prop + PropDatabase (id 0..3, nama Indonesia)
//    - MapPlaceholder.prefab  : tile diganti Tile_Grass/Sand/Stone/Wood per zona + dekor
//    - Canvas di scene aktif  : ikon skill, ikon tombol reward, background lobby
//  Semua langkah null-safe: aset yang tidak ada dilewati + dicatat di log.
//  Boleh dijalankan berulang (idempotent).
// ============================================================================
#if UNITY_EDITOR
using HideSeek.Core;
using HideSeek.Skills;
using HideSeek.UI;
using HideSeek.Utils;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace HideSeek.EditorTools
{
    public static class HideSeekArtInstaller
    {
        private const string Art = "Assets/Art/HideSeek";

        private static int applied, skipped;
        private static readonly System.Text.StringBuilder report = new System.Text.StringBuilder();

        [MenuItem("HideSeek/Setup/5. Pasang Art AI (karakter, prop, peta, UI)")]
        public static void Install()
        {
            applied = skipped = 0;
            report.Length = 0;

            if (AssetDatabase.IsValidFolder(Art) == false)
            {
                EditorUtility.DisplayDialog("HideSeek",
                    "Folder " + Art + " belum ada.\n\n" +
                    "Generate aset AI -> taruh di ArtRaw/ -> jalankan:\n" +
                    "  python3 Tools/hideseek_art_postprocess.py\n" +
                    "lalu jalankan menu ini lagi.", "OK");
                return;
            }

            // 1) karakter di prefab pemain
            Sprite hider = LoadSprite("Characters/Chameleon_Hider");
            Sprite seeker = LoadSprite("Characters/Chameleon_Seeker");
            InstallCharacter(hider, seeker);

            // 2) prop + database
            InstallProps();

            // 3) peta (tile + dinding + dekor)
            InstallMap();

            // 4) UI di scene yang sedang dibuka
            InstallSceneUI(hider);

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            Debug.Log("[HideSeek/Art] Selesai. " + applied + " dipasang, " + skipped + " dilewati.\n" + report);
            EditorUtility.DisplayDialog("HideSeek Art",
                applied + " referensi aset dipasang, " + skipped + " dilewati (tidak ada file).\n\n" +
                "Cek Console untuk daftar lengkapnya.", "OK");
        }

        // ============================== KARAKTER ===============================

        private static void InstallCharacter(Sprite hider, Sprite seeker)
        {
            string path = HideSeekSetupTool.PlayerPrefabPath;
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(path);
            if (prefab == null) { Skip("prefab pemain tidak ada (" + path + ") - jalankan Setup > 1 dulu"); return; }

            GameObject root = PrefabUtility.LoadPrefabContents(path);
            try
            {
                // sprite utama: child "Visual" bila ada, kalau tidak SpriteRenderer pertama
                var vis = root.transform.Find("Visual");
                var sr = vis != null ? vis.GetComponent<SpriteRenderer>() : root.GetComponentInChildren<SpriteRenderer>(true);
                if (sr == null) { Skip("prefab pemain tidak punya SpriteRenderer"); }
                else
                {
                    if (hider != null) { sr.sprite = hider; sr.color = Color.white; sr.sortingOrder = 10; Apply("sprite karakter = Chameleon_Hider"); }
                    else Skip("Characters/Chameleon_Hider.png tidak ada");

                    // RoleSkin: pembeda visual Hider vs Seeker tanpa tint warna
                    var skin = root.GetComponent<RoleSkin>();
                    if (skin == null) skin = root.AddComponent<RoleSkin>();
                    skin.hiderSprite = hider;
                    skin.seekerSprite = seeker;
                    skin.visualRoot = sr.transform;
                    EditorUtility.SetDirty(skin);
                    Apply("RoleSkin (hider=" + (hider != null ? "ya" : "tidak") + ", seeker=" + (seeker != null ? "ya" : "tidak") + ")");
                }

                if (PrefabUtility.SaveAsPrefabAsset(root, path)) Apply("simpan " + path);
            }
            finally { PrefabUtility.UnloadPrefabContents(root); }

            // salinan di Assets/Prefabs ikut disegarkan (field Inspector memakai salinan ini)
            HideSeekSetupTool.CopyPrefab(path, HideSeekSetupTool.PrefabFolder + "/" + HideSeekPrefabs.Player + ".prefab");
            Apply("salinan ke " + HideSeekSetupTool.PrefabFolder);
        }

        // ================================ PROPS ================================

        private static readonly string[] PropSprites = { "Prop_Table", "Prop_Chair", "Prop_FlowerPot", "Prop_Crate" };
        private static readonly string[] PropNames = { "Meja", "Kursi", "Pot Bunga", "Peti" };

        /// <summary>Perbarui prefab Prop_0..3 (dibuat bila belum ada) lalu sinkronkan PropDatabase.</summary>
        private static void InstallProps()
        {
            var prefabs = new GameObject[PropSprites.Length];

            for (int i = 0; i < PropSprites.Length; i++)
            {
                string p = HideSeekSetupTool.Root + "/Prop_" + i + ".prefab";
                Sprite sp = LoadSprite("Props/" + PropSprites[i]);
                if (sp == null) { Skip("Props/" + PropSprites[i] + ".png tidak ada"); continue; }

                GameObject go = AssetDatabase.LoadAssetAtPath<GameObject>(p);
                bool created = go == null;
                if (created)
                {
                    // Prop_3 belum ada -> tiru struktur Prop_0
                    var basePrefab = AssetDatabase.LoadAssetAtPath<GameObject>(HideSeekSetupTool.Root + "/Prop_0.prefab");
                    if (basePrefab == null) { Skip("Prop_0.prefab tidak ada, tidak bisa membuat Prop_" + i); continue; }
                    GameObject tmp = Object.Instantiate(basePrefab);
                    tmp.name = "Prop_" + i;
                    go = PrefabUtility.SaveAsPrefabAsset(tmp, p);
                    Object.DestroyImmediate(tmp);
                    Apply("Prop_" + i + ".prefab dibuat (turunan Prop_0)");
                }

                GameObject contents = PrefabUtility.LoadPrefabContents(p);
                try
                {
                    var srs = contents.GetComponentsInChildren<SpriteRenderer>(true);
                    if (srs.Length == 0) { Skip("Prop_" + i + " tidak punya SpriteRenderer"); }
                    for (int k = 0; k < srs.Length; k++)
                    {
                        srs[k].sprite = sp;
                        srs[k].color = Color.white;
                        srs[k].sortingOrder = 4;          // di atas tile (0) & dekor (2), di bawah karakter (10)
                        EditorUtility.SetDirty(srs[k]);
                    }
                    if (PrefabUtility.SaveAsPrefabAsset(contents, p)) Apply("sprite Prop_" + i + " = " + PropSprites[i]);
                }
                finally { PrefabUtility.UnloadPrefabContents(contents); }

                prefabs[i] = AssetDatabase.LoadAssetAtPath<GameObject>(p);
            }

            // PropDatabase: id/nama/prefab + tint putih (sprite sudah berwarna)
            var db = AssetDatabase.LoadAssetAtPath<PropDatabase>(HideSeekSetupTool.Root + "/PropDatabase.asset");
            if (db == null) { Skip("PropDatabase.asset tidak ada"); return; }

            var so = new SerializedObject(db);
            var arr = so.FindProperty("props");
            if (arr == null) { Skip("field props tidak ditemukan di PropDatabase"); return; }
            if (arr.arraySize < PropSprites.Length) arr.arraySize = PropSprites.Length;

            for (int i = 0; i < PropSprites.Length; i++)
            {
                SerializedProperty e = arr.GetArrayElementAtIndex(i);
                e.FindPropertyRelative("id").byteValue = (byte)i;
                e.FindPropertyRelative("displayName").stringValue = PropNames[i];
                e.FindPropertyRelative("tintColor").colorValue = Color.white;
                if (prefabs[i] != null) e.FindPropertyRelative("prefab").objectReferenceValue = prefabs[i];
            }
            so.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(db);
            Apply("PropDatabase: " + PropSprites.Length + " entri (id 0.." + (PropSprites.Length - 1) + ")");
        }

        // ================================= PETA ================================

        /// <summary>
        /// Ganti sprite tile MapPlaceholder per zona supaya skill Kamuflase punya warna dasar
        /// yang jelas beda: padang rerumputan, tanah lapangan, jalur batu, lantai kayu.
        /// </summary>
        private static void InstallMap()
        {
            string p = HideSeekSetupTool.Root + "/" + HideSeekPrefabs.PlaceholderMap + ".prefab";
            var mapPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(p);
            if (mapPrefab == null) { Skip("MapPlaceholder.prefab tidak ada"); return; }

            Sprite grass = LoadSprite("Tiles/Tile_Grass");
            Sprite sand = LoadSprite("Tiles/Tile_Sand");
            Sprite stone = LoadSprite("Tiles/Tile_Stone");
            Sprite wood = LoadSprite("Tiles/Tile_Wood");
            Sprite hedge = LoadSprite("Decor/Hedge_Wall");
            Sprite bush = LoadSprite("Decor/Bush");
            Sprite rocks = LoadSprite("Decor/Rocks");
            Sprite shrooms = LoadSprite("Decor/Mushrooms");

            int tiles = 0;
            var contents = PrefabUtility.LoadPrefabContents(p);
            try
            {
                foreach (Transform child in contents.transform)
                {
                    string n = child.name;
                    if (!n.StartsWith("tile_")) continue;

                    string[] parts = n.Split('_');               // tile_x_y
                    int x, y;
                    if (parts.Length != 3 || !int.TryParse(parts[1], out x) || !int.TryParse(parts[2], out y)) continue;

                    var sr = child.GetComponent<SpriteRenderer>();
                    if (sr == null) continue;

                    Sprite want = PickTile(x, y, grass, sand, stone, wood);
                    if (want == null) continue;
                    sr.sprite = want;
                    sr.color = Color.white;                       // warna datang dari teksturnya (bukan tint)
                    sr.sortingOrder = 0;
                    EditorUtility.SetDirty(sr);
                    tiles++;
                }
                Apply("peta: " + tiles + " tile memakai tekstur tanah");

                // dinding -> hedge (tetap layer Ground agar menahan pushback)
                if (hedge != null)
                {
                    int walls = 0;
                    foreach (Transform child in contents.transform)
                    {
                        if (!child.name.StartsWith("wall_")) continue;
                        var sr = child.GetComponent<SpriteRenderer>();
                        if (sr == null) continue;
                        sr.sprite = hedge;
                        sr.color = new Color(0.85f, 0.9f, 0.8f, 1f);
                        sr.sortingOrder = 1;
                        EditorUtility.SetDirty(sr);
                        walls++;
                    }
                    Apply("peta: " + walls + " dinding = Hedge_Wall");
                }
                else Skip("Decor/Hedge_Wall.png tidak ada (dinding tetap warna polos)");

                // dekorasi: rerumputan/batu/cendawan - TANPA collider (murni visual, tidak menghalangi)
                if (bush != null || rocks != null || shrooms != null)
                {
                    int decor = 0;
                    Vector2[] spots = { new Vector2(-7.2f, 4.1f), new Vector2(6.4f, 3.6f), new Vector2(-4.1f, -4.2f),
                                        new Vector2(3.2f, -4.4f), new Vector2(7.4f, -1.2f), new Vector2(-7.4f, 0.6f) };
                    Sprite[] pool = { bush, rocks, shrooms, bush, shrooms, rocks };
                    for (int i = 0; i < spots.Length; i++)
                    {
                        if (pool[i] == null) continue;
                        var old = contents.transform.Find("decor_" + i);
                        if (old != null) Object.DestroyImmediate(old.gameObject);

                        var go = new GameObject("decor_" + i, typeof(SpriteRenderer));
                        go.transform.SetParent(contents.transform, false);
                        go.transform.localPosition = new Vector3(spots[i].x, spots[i].y, 0f);
                        var sr = go.GetComponent<SpriteRenderer>();
                        sr.sprite = pool[i];
                        sr.color = Color.white;
                        sr.sortingOrder = 2;                      // di atas tile, di bawah karakter
                        decor++;
                    }
                    Apply("peta: " + decor + " dekorasi ditambahkan");
                }

                if (PrefabUtility.SaveAsPrefabAsset(contents, p)) Apply("simpan MapPlaceholder.prefab");
            }
            finally { PrefabUtility.UnloadPrefabContents(contents); }
        }

        /// <summary>Zona peta: tengah = tanah, baris tengah = batu, pojok = kayu, sisanya rumput.</summary>
        private static Sprite PickTile(int x, int y, Sprite grass, Sprite sand, Sprite stone, Sprite wood)
        {
            if (y == 0 && Mathf.Abs(x) <= 8) return stone ?? grass;                       // jalur utama
            if (Mathf.Abs(x) <= 3 && Mathf.Abs(y) <= 2) return sand ?? grass;             // lapangan tengah
            bool corner = (x <= -6 && y >= 3) || (x >= 6 && y <= -3);
            if (corner) return wood ?? sand;                                              // gubuk kayu
            return grass ?? sand ?? stone ?? wood;
        }

        // ================================== UI =================================

        private static void InstallSceneUI(Sprite playerSprite)
        {
            var ui = UnityEngine.Object.FindObjectOfType<UIManager>();
            if (ui == null) { Skip("UIManager tidak ada di scene aktif (jalankan Setup > 3 dulu)"); return; }

            // ikon skill: gambar kecil di dalam tombol + label digeser ke bawah
            var icons = new[] { LoadSprite("Icons/Icon_Camouflage"), LoadSprite("Icons/Icon_PropSwap"),
                                LoadSprite("Icons/Icon_Radar"), LoadSprite("Icons/Icon_SonicBlast") };
            var so = new SerializedObject(ui);
            var skills = so.FindProperty("skills");
            if (skills != null)
            {
                for (int i = 0; i < skills.arraySize; i++)
                {
                    Button b = skills.GetArrayElementAtIndex(i).FindPropertyRelative("button").objectReferenceValue as Button;
                    if (b == null) continue;
                    // slot 0/1 = tombol hider ( Kamuflase / Prop Swap); slot 2/3 (bila diisi) = seeker
                    Sprite icon = i < icons.Length ? icons[i] : null;
                    if (icon == null) continue;
                    MakeIconOverlay(b, icon);
                    Log("ikon skill slot " + i + " = " + icon.name);
                }
            }

            // ikon tombol reward (RewardBtn dibuat oleh Setup > 3, child dari Canvas yang sama)
            var rewardBtn = FindChildButton(ui.gameObject, "RewardBtn");
            var reviveIcon = LoadSprite("Icons/Icon_Revive");
            if (rewardBtn != null && reviveIcon != null)
            {
                var img = rewardBtn.targetGraphic as Image;
                if (img != null) { img.sprite = reviveIcon; img.color = Color.white; EditorUtility.SetDirty(img); Apply("ikon tombol reward = Icon_Revive"); }
            }

            var canvas = ui.GetComponentInParent<Canvas>();
            if (canvas == null) canvas = ui.gameObject.GetComponentInParent<Canvas>();
            var bg = LoadSprite("Background/Bg_Lobby");
            if (canvas != null && bg != null)
            {
                Transform existing = canvas.transform.Find("BgLobby");
                GameObject go = existing != null ? existing.gameObject : new GameObject("BgLobby", typeof(RectTransform), typeof(Image));
                go.transform.SetParent(canvas.transform, false);
                go.transform.SetAsFirstSibling();
                var rt = go.GetComponent<RectTransform>();
                rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one; rt.offsetMin = rt.offsetMax = Vector2.zero;
                var im = go.GetComponent<Image>();
                im.sprite = bg; im.color = Color.white; im.raycastTarget = false;
                EditorUtility.SetDirty(im);
                Apply("background lobby = Bg_Lobby");
            }
            else Skip("background lobby tidak dipasang (canvas atau sprite tidak ada)");

            EditorUtility.SetDirty(ui);
            var scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene();
            if (scene.IsValid()) UnityEditor.SceneManagement.EditorSceneManager.MarkSceneDirty(scene);
        }

        /// <summary>Tambah Image kecil di bagian atas tombol sebagai ikon, label digeser ke bawah.</summary>
        private static void MakeIconOverlay(Button button, Sprite icon)
        {
            var parent = button.transform;
            Transform old = parent.Find("SkillIcon");
            GameObject go = old != null ? old.gameObject : new GameObject("SkillIcon", typeof(RectTransform), typeof(Image));
            go.transform.SetParent(parent, false);
            var rt = go.GetComponent<RectTransform>();
            rt.anchorMin = new Vector2(0.5f, 0.78f); rt.anchorMax = new Vector2(0.5f, 0.78f);
            rt.pivot = new Vector2(0.5f, 0.5f);
            rt.sizeDelta = new Vector2(74, 74);
            var im = go.GetComponent<Image>();
            im.sprite = icon; im.color = Color.white; im.raycastTarget = false;
            im.preserveAspect = true;

            var label = parent.GetComponentInChildren<Text>(true);
            if (label != null && label.gameObject.name != "SkillIcon")
            {
                var lrt = label.rectTransform;
                lrt.anchorMin = new Vector2(0.5f, 0.22f); lrt.anchorMax = new Vector2(0.5f, 0.22f);
                lrt.anchoredPosition = Vector2.zero;
                EditorUtility.SetDirty(label);
            }
        }

        private static Button FindChildButton(GameObject root, string name)
        {
            var t = FindRecursive(root.transform, name);
            return t != null ? t.GetComponent<Button>() : null;
        }

        private static Transform FindRecursive(Transform parent, string name)
        {
            for (int i = 0; i < parent.childCount; i++)
            {
                Transform c = parent.GetChild(i);
                if (c.name == name) return c;
                Transform deep = FindRecursive(c, name);
                if (deep != null) return deep;
            }
            return null;
        }

        // =============================== HELPERS ===============================

        private static Sprite LoadSprite(string rel)
        {
            string path = Art + "/" + rel + ".png";
            var s = AssetDatabase.LoadAssetAtPath<Sprite>(path);
            if (s != null) return s;
            if (AssetDatabase.LoadAssetAtPath<Texture2D>(path) != null)
                Log("catatan: " + rel + ".png ada tapi belum berbentuk Sprite -> klik kanan > Reimport");
            return null;
        }

        private static void Apply(string msg) { applied(); Log(msg); }
        private static void Skip(string msg) { skipped++; Log("LEWATI: " + msg); }
        private static void applied() { applied++; }
        private static void Log(string m) { report.AppendLine("  - " + m); }
    }
}
#endif
