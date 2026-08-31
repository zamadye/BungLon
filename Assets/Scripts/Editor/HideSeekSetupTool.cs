// ============================================================================
//  HideSeekSetupTool.cs  (EDITOR ONLY - tidak ikut build)
//  Percepat setup project: membuat sprite/prefab/database placeholder + scene UI
//  yang sudah ter-wiring, supaya "HideSeek Online" bisa langsung di-playtest.
//
//  Menu:
//    HideSeek > Setup > 1. Generate Placeholder Assets
//    HideSeek > Setup > 2. Set Layer 6 = Ground
//    HideSeek > Setup > 3. Build Demo Scene (in current scene)
//  Semua langkah idempotent (aman dijalankan 2x). Aset ditulis ke
//  Prefab PEMAIN disimpan di ROOT Assets/Resources/ (syarat PhotonNetwork.Instantiate),
//  aset lain (sprite, ring, peta, prop, database) di Assets/Resources/HideSeek/
//  tanpa harus mengisi field Inspector.
// ============================================================================
#if UNITY_EDITOR
using System.Collections.Generic;
using System.IO;
using HideSeek.Core;
using HideSeek.Game;
using HideSeek.Network;
using HideSeek.Players;
using HideSeek.Skills;
using HideSeek.UI;
using HideSeek.Utils;
using Photon.Pun;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace HideSeek.EditorTools
{
    public static class HideSeekSetupTool
    {
        /// <summary>Folder isi: sprite, PropDatabase, ring, peta placeholder, prop.</summary>
        internal const string Root = "Assets/Resources/HideSeek";
        private const string Sprites = Root + "/Sprites";

        /// <summary>
        /// ROOT Resources - HANYA di sini PUN2 (DefaultPool) bisa menemukan prefab yang di-
        /// Instantiate lewat nama: PhotonNetwork.Instantiate("PlayerNetworked"). Sub-folder
        /// tidak dibaca oleh Resources.Load(name), jadi prefab pemain WAJIB di sini.
        /// </summary>
        internal const string NetResources = "Assets/Resources";
        internal const string PlayerPrefabPath = NetResources + "/" + HideSeekPrefabs.Player + ".prefab";

        /// <summary>Salinan prefab untuk konvensi folder proyek (di-assign ke NetworkManager.playerPrefab).</summary>
        internal const string PrefabFolder = "Assets/Prefabs";
        private const float PPU = 32f;

        // ============================ MENU 1 ===================================
        [MenuItem("HideSeek/Setup/1. Generate Placeholder Assets")]
        public static void GeneratePlaceholders()
        {
            EnsureFolder(Root);
            EnsureFolder(Sprites);
            EnsureGroundLayer();      // prop & tile tanah butuh layer 'Ground' sejak awal

            Sprite white = WriteSprite("white", 32, 32, (x, y, w, h) => true, Color.white);
            Sprite circle = WriteSprite("circle", 32, 32, CircleMask, Color.white);
            AssetDatabase.SaveAssets();

            // Urutan penting: PropDatabase dulu (dipakai prefab pemain), lalu pemain, ring, dan peta.
            PropDatabase db = BuildPropDatabase(white);
            GameObject player = BuildPlayerPrefab(circle, db);
            GameObject ring = BuildSonicRing(circle);
            BuildPlaceholderMap(white);

            EnsureFolder(NetResources);
            EnsureFolder(PrefabFolder);

            // Prefab pemain: WAJIB di root Resources + salinan di Assets/Prefabs (untuk field Inspector).
            PrefabUtility.SaveAsPrefabAsset(player, PlayerPrefabPath);
            RegisterInPunPrefabList(PlayerPrefabPath);
            CopyPrefab(PlayerPrefabPath, PrefabFolder + "/" + HideSeekPrefabs.Player + ".prefab");

            PrefabUtility.SaveAsPrefabAsset(ring, Root + "/" + HideSeekPrefabs.SonicRing + ".prefab");
            PrefabUtility.SaveAsPrefabAsset(mapRoot, Root + "/" + HideSeekPrefabs.PlaceholderMap + ".prefab");
            Object.DestroyImmediate(player);
            Object.DestroyImmediate(ring);
            Object.DestroyImmediate(mapRoot);
            EditorUtility.DisplayDialog("HideSeek",
                "Placeholder selesai dibuat.\n" +
                "- Prefab pemain  : " + PlayerPrefabPath + "   (harus di root Resources)\n" +
                "- Aset lain      : " + Root + "\n" +
                "- Salinan prefab : " + PrefabFolder + "\n" +
                "Lalu jalankan: HideSeek > Setup > 3. Build Demo Scene", "OK");

            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Debug.Log("[HideSeek] Placeholder assets selesai. Player: " + PlayerPrefabPath + " | lain: " + Root +
                      "\n -> lanjutkan: HideSeek > Setup > 3. Build Demo Scene");
        }

        // ============================ MENU 2 ===================================
        [MenuItem("HideSeek/Setup/2. Set Layer 6 = Ground")]
        public static void SetGroundLayer()
        {
            var ta = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/TagManager.asset");
            if (ta == null || ta.Length == 0) { Debug.LogError("[HideSeek] TagManager tidak ditemukan."); return; }

            var so = new SerializedObject(ta[0]);
            SerializedProperty layers = so.FindProperty("layers");
            if (layers == null || HideSeekConstants.GroundLayerIndex >= layers.arraySize) return;

            layers.GetArrayElementAtIndex(HideSeekConstants.GroundLayerIndex).stringValue = "Ground";
            so.ApplyModifiedProperties();
            AssetDatabase.SaveAssets();
            Debug.Log("[HideSeek] Layer " + HideSeekConstants.GroundLayerIndex + " = 'Ground'.");
        }

        /// <summary>Layer 6 bernama 'Ground'? Bila belum, set otomatis (dipanggil BuildDemoScene).</summary>
        /// <summary>Salin prefab ke folder lain (yang lama dihapus supaya tidak dobel).</summary>
        internal static void CopyPrefab(string fromPath, string toPath)
        {
            if (AssetDatabase.LoadAssetAtPath<Object>(toPath) != null) AssetDatabase.DeleteAsset(toPath);
            if (!AssetDatabase.CopyAsset(fromPath, toPath))
                Debug.LogWarning("[HideSeek] Gagal menyalin prefab ke " + toPath + " (tidak fatal).");
        }

        /// <summary>
        /// Opsional: daftarkan path prefab ke PhotonServerSettings -> "Pun Prefabs". Berguna bila
        /// prefab nanti dipindah keluar Resources. Dibungkus try/catch agar tool tetap jalan
        /// walau versi PUN2 tidak punya field tersebut.
        /// </summary>
        private static void RegisterInPunPrefabList(string assetPath)
        {
            try
            {
                var settings = PhotonNetwork.PhotonServerSettings;
                if (settings == null) return;
                var so = new SerializedObject(settings);
                SerializedProperty list = so.FindProperty("PunPrefabs");
                if (list == null) return;
                for (int i = 0; i < list.arraySize; i++)
                    if (list.GetArrayElementAtIndex(i).stringValue == assetPath) return;
                list.InsertArrayElementAtIndex(list.arraySize);
                list.GetArrayElementAtIndex(list.arraySize - 1).stringValue = assetPath;
                so.ApplyModifiedPropertiesWithoutUndo();
                EditorUtility.SetDirty(settings);
            }
            catch (System.Exception e)
            {
                Debug.Log("[HideSeek] (info) PunPrefabs dilewati: " + e.Message);
            }
        }

        // ============================ MENU 4 ===================================
        /// <summary>
        /// Membuat 2 file scene siap pakai (Assets/Scenes/Lobby.unity + Game.unity), mengisinya
        /// dengan NetworkManager/GameManager/Canvas/EventSystem, lalu mendaftarkannya ke Build
        /// Settings. Setelah ini tidak perlu drag-drop scene manual lagi.
        /// </summary>
        [MenuItem("HideSeek/Setup/4. Buat Scene Lobby + Game + Build Settings")]
        public static void CreateLobbyAndGameScenes()
        {
            const string scenesFolder = "Assets/Scenes";
            EnsureFolder(scenesFolder);
            EnsureGroundLayer();

            for (int pass = 0; pass < 2; pass++)
            {
                bool isLobby = pass == 0;
                string sceneName = isLobby ? "Lobby" : "Game";
                string path = scenesFolder + "/" + sceneName + ".unity";

                var scene = EditorSceneManager.NewScene(NewSceneSetup.DefaultGameObjects, NewSceneMode.Single);
                BuildDemoScene();

                var nm = UnityEngine.Object.FindObjectOfType<NetworkManager>();
                if (nm != null)
                {
                    SetStr(nm, "lobbySceneName", "Lobby");
                    SetStr(nm, "gameSceneName", "Game");
                    SetBool(nm, "autoConnectOnAwake", isLobby);   // connect dari Lobby; Game sudah di dalam room
                }

                var gm = UnityEngine.Object.FindObjectOfType<GameManager>();
                if (gm != null) SetBool(gm, "loadGameSceneOnStart", isLobby);  // hanya Lobby yang pindah scene

                if (!EditorSceneManager.SaveScene(scene, path))
                {
                    Debug.LogError("[HideSeek] Gagal menyimpan " + path);
                    return;
                }
                Debug.Log("[HideSeek] Scene dibuat: " + path);
            }

            // Build Settings: kedua scene WAJIB ada, kalau tidak LoadScene("Game") gagal saat runtime.
            var build = new System.Collections.Generic.List<EditorBuildSettingsScene>
            {
                new EditorBuildSettingsScene(scenesFolder + "/Lobby.unity", true),
                new EditorBuildSettingsScene(scenesFolder + "/Game.unity", true)
            };
            EditorBuildSettings.scenes = build.ToArray();
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();

            EditorSceneManager.OpenScene(scenesFolder + "/Lobby.unity");
            EditorUtility.DisplayDialog("HideSeek",
                "Scene Lobby + Game sudah dibuat dan masuk Build Settings.\n" +
                "Langkah tersisa: isi App ID (Window > Photon Unity Networking > Highlights > Server Settings), " +
                "lalu Play di scene Lobby.", "OK");
        }

        private static void EnsureGroundLayer()
        {
            if (LayerMask.NameToLayer("Ground") == HideSeekConstants.GroundLayerIndex) return;
            SetGroundLayer();
        }

        // ============================ MENU 3 ===================================
        private static GameObject mapRoot;

        [MenuItem("HideSeek/Setup/3. Build Demo Scene (current scene)")]
        public static void BuildDemoScene()
        {
            EnsureGroundLayer();
            EnsureFolder(Root);
            if (AssetDatabase.LoadAssetAtPath<GameObject>(PlayerPrefabPath) == null)
            {
                Debug.LogWarning("[HideSeek] Placeholder belum dibuat -> menjalankan langkah 1 dulu.");
                GeneratePlaceholders();
            }

            // --- Kamera + peta ---
            Camera cam = Camera.main;
            GameObject camGo = cam != null ? cam.gameObject : new GameObject("Main Camera", typeof(Camera));
            if (cam == null)
            {
                cam = camGo.AddComponent<Camera>();
                camGo.tag = "MainCamera";
            }
            cam.orthographic = true;
            cam.clearFlags = CameraClearFlags.SolidColor;
            BackgroundColor();
            if (camGo.GetComponent<PlayerCamera>() == null) camGo.AddComponent<PlayerCamera>();

            var map = AssetDatabase.LoadAssetAtPath<GameObject>(Root + "/" + HideSeekPrefabs.PlaceholderMap + ".prefab");
            if (map != null && GameObject.Find("MapPlaceholder") == null)
                PrefabUtility.InstantiatePrefab(map);

            // --- EventSystem (wajib untuk joystick/tombol) ---
            if (Object.FindObjectOfType<EventSystem>() == null)
            {
                new GameObject("EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
            }

            // --- NetworkManager + GameManager ---
            var nmGo = new GameObject("NetworkManager");
            var nm = nmGo.AddComponent<NetworkManager>();
            var playerPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(PrefabFolder + "/" + HideSeekPrefabs.Player + ".prefab");
            if (playerPrefab == null) playerPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(PlayerPrefabPath);
            SetObj(nm, "playerPrefab", playerPrefab);
            SetObj(nm, "gameSceneName", EditorSceneManager.GetActiveScene().name);
            SetStr(nm, "lobbySceneName", "Lobby");
            SetBool(nm, "autoConnectOnAwake", false);      // biar tidak auto-connect saat setup
            SetBool(nm, "verboseLogs", true);

            var gmGo = new GameObject("HideSeek_GameRoot");
            gmGo.AddComponent<GameManager>();
            // RewardOffers (+AdsManager) ikut dibuat supaya alur rewarded ad bisa dites tanpa setup.
            if (gmGo.GetComponent<HideSeek.Monetization.RewardOffers>() == null)
                gmGo.AddComponent<HideSeek.Monetization.RewardOffers>();

            // --- UI Canvas ---
            BuildCanvas(out UIManager ui, out RoomListUI rl, playerPrefab);

            // --- Physics 2D: tidak ada gravitasi untuk top-down ---
            Physics2D.gravity = Vector2.zero;

            EditorSceneManager.MarkSceneDirty(EditorSceneManager.GetActiveScene());
            Debug.Log("[HideSeek] Demo scene siap. Tekan Play (offlineMode=true di NetworkManager untuk test 1 orang).");
        }

        // ============================== UI =====================================

        /// <summary>Buat Canvas + semua elemen UI + wiring field UIManager/RoomListUI.</summary>
        private static void BuildCanvas(out UIManager ui, out RoomListUI rl, GameObject playerPrefab)
        {
            var canvasGo = new GameObject("HideSeek_Canvas", typeof(Canvas), typeof(CanvasScaler),
                                          typeof(GraphicRaycaster), typeof(CanvasRenderer));
            var canvas = canvasGo.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = canvasGo.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1080, 1920);
            scaler.matchWidthOrHeight = 0.5f;

            ui = canvasGo.AddComponent<UIManager>();

            // ---------- LOBBY PANEL ----------
            GameObject lobby = Panel(canvasGo.transform, "LobbyPanel", new Color(0.06f, 0.08f, 0.12f, 1f));
            MakeText(lobby.transform, "Title", "HIDESEEK ONLINE", 64,
                     new Vector2(0.5f, 0.9f), new Vector2(700, 120));
            Text conn = MakeText(lobby.transform, "Connection", "offline", 24,
                                 new Vector2(0.5f, 0.78f), new Vector2(700, 40));
            Text empty = MakeText(lobby.transform, "EmptyInfo", "belum ada room", 22,
                                  new Vector2(0.5f, 0.55f), new Vector2(700, 40));

            GameObject roomListRoot = new GameObject("RoomList", typeof(RectTransform), typeof(VerticalLayoutGroup),
                                                      typeof(ContentSizeFitter));
            roomListRoot.transform.SetParent(lobby.transform, false);
            var rrt = roomListRoot.transform as RectTransform;
            rrt.anchorMin = new Vector2(0.1f, 0.28f); rrt.anchorMax = new Vector2(0.9f, 0.66f);
            rrt.offsetMin = rrt.offsetMax = Vector2.zero;
            var vlg = roomListRoot.GetComponent<VerticalLayoutGroup>();
            vlg.spacing = 6; vlg.childControlHeight = true; vlg.childForceExpandHeight = false;
            vlg.childControlWidth = true; vlg.childForceExpandWidth = true;
            var csf = roomListRoot.GetComponent<ContentSizeFitter>();
            csf.verticalFit = ContentSizeFitter.FitMode.PreferredSize;

            Button createBtn = MakeButton(lobby.transform, "CreateRoomBtn", "CREATE ROOM", new Vector2(0.5f, 0.2f), new Color(0.2f, 0.65f, 0.35f));
            Button quickBtn = MakeButton(lobby.transform, "QuickPlayBtn", "QUICK PLAY", new Vector2(0.5f, 0.14f), new Color(0.2f, 0.45f, 0.75f));
            Button refreshBtn = MakeButton(lobby.transform, "RefreshBtn", "REFRESH", new Vector2(0.5f, 0.08f), new Color(0.4f, 0.4f, 0.45f));

            InputField nameInput = MakeInputField(lobby.transform, "RoomNameInput", "room name (optional)", new Vector2(0.3f, 0.26f));
            Toggle privToggle = MakeToggle(lobby.transform, "PrivateToggle", "private room", new Vector2(0.72f, 0.26f));
            InputField nickInput = MakeInputField(lobby.transform, "PlayerNameInput", "your name", new Vector2(0.3f, 0.32f));

            // ---------- HUD ----------
            GameObject hud = Panel(canvasGo.transform, "HudPanel", new Color(0, 0, 0, 0));
            Text phase = MakeText(hud.transform, "PhaseText", "LOBBY", 30, new Vector2(0.5f, 0.95f), new Vector2(700, 44));
            Text timer = MakeText(hud.transform, "TimerText", "01:00", 72, new Vector2(0.5f, 0.885f), new Vector2(700, 100));
            Text role = MakeText(hud.transform, "RoleText", "menunggu role...", 26, new Vector2(0.5f, 0.82f), new Vector2(700, 40));
            Text hint = MakeText(hud.transform, "HintText", "", 20, new Vector2(0.5f, 0.76f), new Vector2(900, 60));
            Text players = MakeText(hud.transform, "PlayersText", "Pemain: 0/0", 20, new Vector2(0.5f, 0.71f), new Vector2(700, 30));

            // HP: bar (filled) + 3 hearts
            Image hpBar = MakeFilledImage(hud.transform, "HpBar", new Vector2(0.18f, 0.64f), new Vector2(420, 26),
                                          new Color(0.9f, 0.25f, 0.25f, 1f));
            Text hpText = MakeText(hud.transform, "HpText", "HP 3/3", 20, new Vector2(0.18f, 0.585f), new Vector2(420, 26));
            Image[] hearts = MakeHearts(hud.transform, new Vector2(0.18f, 0.53f));

            // Skill buttons (2) + cooldown fill
            Image[] fills = new Image[2];
            Button[] btns = new Button[2];
            for (int i = 0; i < 2; i++)
            {
                float ax = i == 0 ? 0.84f : 0.94f;
                btns[i] = MakeButton(hud.transform, "SkillBtn" + i, i == 0 ? "SKILL 1" : "SKILL 2",
                                     new Vector2(ax, 0.14f), new Color(0.15f, 0.5f, 0.7f, 0.9f), 150f, 150f);
                var imgGo = new GameObject("Cooldown", typeof(RectTransform), typeof(Image));
                imgGo.transform.SetParent(btns[i].transform, false);
                fills[i] = imgGo.GetComponent<Image>();
                fills[i].color = new Color(0f, 0f, 0f, 0.65f);
                fills[i].type = Image.Type.Filled;
                fills[i].fillMethod = Image.Method.Radial;
                fills[i].fillAmount = 0f;
                var frt = fills[i].rectTransform;
                frt.anchorMin = Vector2.zero; frt.anchorMax = Vector2.one; frt.offsetMin = frt.offsetMax = Vector2.zero;
                fills[i].raycastTarget = false;   // overlay tidak boleh mencuri tap-to-catch
            }

            // Tombol reward rewarded-ad (label & kuota diisi UIManager dari RewardOffers tiap frame)
            Button rewardBtn = MakeButton(hud.transform, "RewardBtn", "IKLAN", new Vector2(0.5f, 0.055f),
                                          new Color(0.85f, 0.55f, 0.1f, 0.95f), 320f, 96f);
            Text rewardLabel = rewardBtn.GetComponentInChildren<Text>();
            Text rewardQuota = MakeText(rewardBtn.transform, "QuotaText", "", 15, new Vector2(0.5f, -0.16f), new Vector2(320, 24));

            // Joystick
            GameObject jb = new GameObject("JoystickBg", typeof(RectTransform), typeof(Image));
            jb.transform.SetParent(hud.transform, false);
            var jrt = jb.transform as RectTransform;
            jrt.anchorMin = new Vector2(0.06f, 0.06f); jrt.anchorMax = new Vector2(0.06f, 0.06f);
            jrt.sizeDelta = new Vector2(240, 240);
            jb.GetComponent<Image>().color = new Color(1f, 1f, 1f, 0.15f);
            var jh = new GameObject("Handle", typeof(RectTransform), typeof(Image));
            jh.transform.SetParent(jb.transform, false);
            var jhrt = jh.transform as RectTransform;
            jhrt.sizeDelta = new Vector2(90, 90);
            jh.GetComponent<Image>().color = new Color(1f, 1f, 1f, 0.5f);
            var joystick = jb.AddComponent<MobileJoystick>();
            joystick.background = jrt;
            joystick.handle = jhrt;
            joystick.radius = 110f;

            // Minimap + radar view
            GameObject mm = new GameObject("Minimap", typeof(RectTransform), typeof(Image));
            mm.transform.SetParent(hud.transform, false);
            var mrt = mm.transform as RectTransform;
            mrt.anchorMin = new Vector2(0.7f, 0.62f); mrt.anchorMax = new Vector2(0.98f, 0.8f);
            mrt.offsetMin = mrt.offsetMax = Vector2.zero;
            mm.GetComponent<Image>().color = new Color(0f, 0f, 0f, 0.35f);
            var radar = mm.AddComponent<MinimapRadarView>();
            SetRect(radar, "worldBounds", new Rect(-10f, -7f, 20f, 14f));   // sama seperti MapPlaceholder

            // Toast
            GameObject toast = new GameObject("Toast", typeof(RectTransform), typeof(Image));
            toast.transform.SetParent(hud.transform, false);
            var trt = toast.transform as RectTransform;
            trt.anchorMin = new Vector2(0.5f, 0.35f); trt.anchorMax = new Vector2(0.5f, 0.35f);
            trt.sizeDelta = new Vector2(760, 70);
            toast.GetComponent<Image>().color = new Color(0f, 0f, 0f, 0.6f);
            Text toastText = MakeText(toast.transform, "ToastText", "", 24, new Vector2(0.5f, 0.5f), new Vector2(720, 60));
            toast.SetActive(false);

            // Countdown overlay
            GameObject cd = Panel(canvasGo.transform, "CountdownOverlay", new Color(0, 0, 0, 0.35f));
            Text cdText = MakeText(cd.transform, "CountdownText", "5", 160, new Vector2(0.5f, 0.5f), new Vector2(600, 220));
            cd.SetActive(false);

            // Result panel
            GameObject result = Panel(canvasGo.transform, "ResultPanel", new Color(0.05f, 0.07f, 0.1f, 0.95f));
            Text resultTitle = MakeText(result.transform, "ResultTitle", "HIDER MENANG!", 60, new Vector2(0.5f, 0.85f), new Vector2(800, 100));
            Text resultDetail = MakeText(result.transform, "ResultDetail", "", 24, new Vector2(0.5f, 0.75f), new Vector2(800, 90));
            var lbRoot = new GameObject("Leaderboard", typeof(RectTransform), typeof(VerticalLayoutGroup), typeof(ContentSizeFitter));
            lbRoot.transform.SetParent(result.transform, false);
            var lrt = lbRoot.transform as RectTransform;
            lrt.anchorMin = new Vector2(0.08f, 0.25f); lrt.anchorMax = new Vector2(0.92f, 0.68f);
            lrt.offsetMin = lrt.offsetMax = Vector2.zero;
            var lvlg = lbRoot.GetComponent<VerticalLayoutGroup>();
            lvlg.spacing = 4; lvlg.childControlWidth = true; lvlg.childForceExpandWidth = true;
            lvlg.childControlHeight = true; lvlg.childForceExpandHeight = false;
            lbRoot.GetComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            Button nextBtn = MakeButton(result.transform, "NextRoundBtn", "NEXT ROUND", new Vector2(0.5f, 0.14f), new Color(0.2f, 0.65f, 0.35f));
            Button leaveBtn = MakeButton(result.transform, "LeaveBtn", "LEAVE", new Vector2(0.5f, 0.07f), new Color(0.65f, 0.25f, 0.25f));
            Button startBtn = MakeButton(lobby.transform, "StartGameBtn", "START GAME (host)", new Vector2(0.5f, 0.02f), new Color(0.75f, 0.55f, 0.15f));
            result.SetActive(false);

            // ---------- wiring UIManager (public fields) ----------
            SetObj(ui, "lobbyPanel", lobby);
            SetObj(ui, "hudPanel", hud);
            SetObj(ui, "resultPanel", result);
            SetObj(ui, "countdownOverlay", cd);
            SetObj(ui, "minimapRoot", mm);
            SetObj(ui, "phaseText", phase);
            SetObj(ui, "timerText", timer);
            SetObj(ui, "roleText", role);
            SetObj(ui, "playersText", players);
            SetObj(ui, "countdownText", cdText);
            SetObj(ui, "connectionText", conn);
            SetObj(ui, "phaseHintText", hint);
            SetObj(ui, "hpBar", hpBar);
            SetObj(ui, "hpText", hpText);
            SetArr(ui, "hearts", hearts);
            SetObj(ui, "joystick", joystick);
            SetObj(ui, "minimap", radar);
            SetObj(ui, "toastRoot", toast);
            SetObj(ui, "toastText", toastText);
            SetObj(ui, "resultTitleText", resultTitle);
            SetObj(ui, "resultDetailText", resultDetail);
            SetObj(ui, "leaderboardRoot", lrt);
            SetObj(ui, "startButton", startBtn);
            SetObj(ui, "leaveButton", leaveBtn);
            SetObj(ui, "nextRoundButton", nextBtn);
            SetObj(ui, "quickPlayButton", quickBtn);
            SetObj(ui, "createRoomButton", createBtn);
            SetObj(ui, "refreshRoomsButton", refreshBtn);
            SetObj(ui, "rewardButton", rewardBtn);
            SetObj(ui, "rewardLabel", rewardLabel);
            SetObj(ui, "rewardQuotaText", rewardQuota);
            WireSkillButtons(ui, btns, fills, new[] { "Kamuflase", "Prop Swap" }, new[] { "Radar", "Sonic Blast" });

            // ---------- RoomListUI ----------
            rl = canvasGo.AddComponent<RoomListUI>();
            SetObj(rl, "contentParent", rrt);
            SetObj(rl, "emptyText", empty);
            SetObj(rl, "headerText", conn);
            SetObj(rl, "roomNameInput", nameInput);
            SetObj(rl, "privateToggle", privToggle);
            SetObj(rl, "playerNameInput", nickInput);   // nama pemain -> NetworkManager.SetPlayerName
            SetObj(rl, "createButton", createBtn);
            SetObj(rl, "refreshButton", refreshBtn);
            SetObj(rl, "quickJoinButton", quickBtn);
            lobby.SetActive(true);
            hud.SetActive(false);
        }

        /// <summary>Isi array SkillButtonConfig[2] lewat SerializedObject (class [Serializable]).</summary>
        private static void WireSkillButtons(UIManager ui, Button[] btns, Image[] fills, string[] hiderLabels, string[] seekerLabels)
        {
            var so = new SerializedObject(ui);
            SerializedProperty arr = so.FindProperty("skills");
            if (arr == null) return;
            arr.arraySize = 2;
            for (int i = 0; i < 2; i++)
            {
                SerializedProperty e = arr.GetArrayElementAtIndex(i);
                e.FindPropertyRelative("button").objectReferenceValue = btns[i];
                e.FindPropertyRelative("cooldownFill").objectReferenceValue = fills[i];
                e.FindPropertyRelative("cooldownText").objectReferenceValue = null;
                e.FindPropertyRelative("hiderLabel").stringValue = hiderLabels[i];
                e.FindPropertyRelative("seekerLabel").stringValue = seekerLabels[i];
            }
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        // ============================ PREFABS ==================================

        private static GameObject BuildPlayerPrefab(Sprite body, PropDatabase database)
        {
            var go = new GameObject(HideSeekPrefabs.Player);

            var rb = go.AddComponent<Rigidbody2D>();
            rb.gravityScale = 0f;
            rb.freezeRotation = true;
            rb.collisionDetectionMode = CollisionDetectionMode2D.Continuous;
            rb.interpolation = RigidbodyInterpolation2D.None;
            rb.mass = 1f;
            rb.drag = 0f;

            var col = go.AddComponent<BoxCollider2D>();
            col.size = new Vector2(0.8f, 0.8f);
            col.isTrigger = false;

            // Trigger ekstra di GameObject yang sama -> PlayerCombat.OnTriggerStay2D (damage saat "disentuh")
            var trig = go.AddComponent<BoxCollider2D>();
            trig.size = new Vector2(1.15f, 1.15f);
            trig.isTrigger = true;

            var visGo = new GameObject("Visual", typeof(SpriteRenderer));
            visGo.transform.SetParent(go.transform, false);
            var sr = visGo.GetComponent<SpriteRenderer>();
            sr.sprite = body;
            sr.color = new Color(0.25f, 0.7f, 0.9f, 1f);
            sr.sortingOrder = 10;

            var visual = go.AddComponent<PlayerVisual>();
            visual.root = visGo.transform;

            var pv = go.AddComponent<PhotonView>();
            var pc = go.AddComponent<PlayerController>();
            var combat = go.AddComponent<PlayerCombat>();
            var hider = go.AddComponent<HiderSkill>();
            var seeker = go.AddComponent<SeekerSkill>();
            var camo = go.AddComponent<CamouflageHelper>();
            var propDb = database;   // database yang baru dibuat (belum tentu tersimpan saat dipanggil pertama kali)

            SetObj(pc, "body", rb);
            SetObj(pc, "visual", visual);
            SetInt(pc, "hiderLayerMask", 1 << LayerMask.NameToLayer("Default"));   // tap raycast hanya ke layer Default (badan pemain)
            SetObj(combat, "controller", pc);
            SetObj(combat, "visual", visual);
            SetObj(combat, "bodyCollider", col);
            SetObj(hider, "controller", pc);
            SetObj(hider, "camouflage", camo);
            SetObj(hider, "visual", visual);
            SetObj(hider, "props", propDb);
            SetObj(seeker, "controller", pc);

            SetObserved(pv, new Component[] { pc, combat });
            return go;
        }

        private static PropDatabase BuildPropDatabase(Sprite white)
        {
            var db = ScriptableObject.CreateInstance<PropDatabase>();

            var entries = new PropDatabase.PropEntry[3];
            string[] names = { "Meja", "Kursi", "Pot Bunga" };
            Vector3[] scales = { new Vector3(1.6f, 1f, 1f), new Vector3(0.8f, 0.9f, 1f), new Vector3(0.7f, 0.7f, 1f) };
            Color[] tints = { new Color(0.55f, 0.38f, 0.25f), new Color(0.45f, 0.33f, 0.22f), new Color(0.35f, 0.6f, 0.3f) };

            for (byte i = 0; i < 3; i++)
            {
                var p = new PropDatabase.PropEntry
                {
                    id = i,
                    displayName = names[i],
                    localScale = scales[i],
                    tintColor = tints[i]
                };

                var go = new GameObject("Prop_" + i, typeof(SpriteRenderer), typeof(BoxCollider2D));
                var sr = go.GetComponent<SpriteRenderer>();
                sr.sprite = white;
                sr.color = tints[i];
                sr.sortingOrder = 5;
                go.transform.localScale = scales[i];
                int ground = LayerMask.NameToLayer("Ground");
                if (ground >= 0) go.layer = ground;
                var c = go.GetComponent<BoxCollider2D>();
                c.size = new Vector2(1f, 1f);

                PrefabUtility.SaveAsPrefabAsset(go, Root + "/Prop_" + i + ".prefab");
                Object.DestroyImmediate(go);

                p.prefab = AssetDatabase.LoadAssetAtPath<GameObject>(Root + "/Prop_" + i + ".prefab");
                entries[i] = p;
            }

            db.props = entries;
            AssetDatabase.CreateAsset(db, Root + "/PropDatabase.asset");
            return db;
        }

        private static GameObject BuildSonicRing(Sprite circle)
        {
            var go = new GameObject(HideSeekPrefabs.SonicRing, typeof(SpriteRenderer));
            var sr = go.GetComponent<SpriteRenderer>();
            sr.sprite = circle;
            sr.color = new Color(1f, 0.85f, 0.2f, 0.9f);
            sr.sortingOrder = 500;
            go.AddComponent<SonicBlastEffect>();
            return go;
        }

        /// <summary>Peta placeholder: grid tile berwarna (agar skill Match Color terlihat bekerja) + dinding.</summary>
        private static void BuildPlaceholderMap(Sprite white)
        {
            mapRoot = new GameObject("MapPlaceholder");
            int ground = LayerMask.NameToLayer("Ground");

            ColorPalette palette = new ColorPalette(new[]
            {
                new Color(0.28f, 0.55f, 0.3f), new Color(0.33f, 0.6f, 0.34f),
                new Color(0.45f, 0.42f, 0.3f), new Color(0.62f, 0.58f, 0.44f),
                new Color(0.38f, 0.4f, 0.45f)
            });

            for (int x = -8; x <= 8; x++)
            {
                for (int y = -5; y <= 5; y++)
                {
                    var t = new GameObject("tile_" + x + "_" + y, typeof(SpriteRenderer), typeof(BoxCollider2D));
                    t.transform.SetParent(mapRoot.transform, false);
                    t.transform.localPosition = new Vector3(x, y, 0);
                    var sr = t.GetComponent<SpriteRenderer>();
                    sr.sprite = white;
                    sr.sortingOrder = 0;
                    sr.color = palette.For(x, y);
                    if (ground >= 0) t.layer = ground;
                    var c = t.GetComponent<BoxCollider2D>();
                    c.size = Vector2.one;
                    c.isTrigger = false;
                }
            }

            // 4 dinding (juga layer ground agar pushback tidak menembus)
            Wall("wall_top", new Vector3(0, 6.2f, 0), new Vector2(19f, 0.6f), ground);
            Wall("wall_bottom", new Vector3(0, -6.2f, 0), new Vector2(19f, 0.6f), ground);
            Wall("wall_left", new Vector3(-9.2f, 0, 0), new Vector2(0.6f, 13f), ground);
            Wall("wall_right", new Vector3(9.2f, 0, 0), new Vector2(0.6f, 13f), ground);

            // Beberapa "prop" statis agar hider punya tempat sembunyi
            var propDb = AssetDatabase.LoadAssetAtPath<PropDatabase>(Root + "/PropDatabase.asset");
            for (int i = 0; i < 6; i++)
            {
                if (propDb == null || propDb.Count == 0) break;
                var entry = propDb.props[i % propDb.Count];
                var pf = entry.ResolvePrefab();
                if (pf == null) continue;
                var inst = (GameObject)PrefabUtility.InstantiatePrefab(pf);
                inst.transform.SetParent(mapRoot.transform, false);
                inst.transform.localPosition = new Vector3(-6 + i * 2.4f, (i % 2 == 0) ? 2.5f : -2.5f, 0);
                inst.name = "prop_" + i;
            }
        }

        private static void Wall(string name, Vector3 pos, Vector2 size, int layer)
        {
            var w = new GameObject(name, typeof(SpriteRenderer), typeof(BoxCollider2D));
            w.transform.SetParent(mapRoot.transform, false);
            w.transform.localPosition = pos;
            w.transform.localScale = new Vector3(size.x, size.y, 1f);
            var sr = w.GetComponent<SpriteRenderer>();
            sr.sprite = whiteSpriteCache;
            sr.color = new Color(0.15f, 0.15f, 0.18f);
            sr.sortingOrder = 1;
            w.GetComponent<BoxCollider2D>().size = Vector2.one;
            if (layer >= 0) w.layer = layer;
        }

        private static Sprite whiteSpriteCache;

        // =============================== TOOLS =================================

        internal static void EnsureFolder(string path)
        {
            if (AssetDatabase.IsValidFolder(path)) return;
            string[] parts = path.Split('/');
            string cur = parts[0];
            for (int i = 1; i < parts.Length; i++)
            {
                string next = cur + "/" + parts[i];
                if (!AssetDatabase.IsValidFolder(next)) AssetDatabase.CreateFolder(cur, parts[i]);
                cur = next;
            }
        }

        /// <summary>Tulis PNG lalu set importer (Single sprite, Read/Write ON, Point filter, PPU 32).</summary>
        private static Sprite WriteSprite(string name, int w, int h, System.Func<int, int, int, int, bool> mask, Color color)
        {
            var tex = new Texture2D(w, h, TextureFormat.RGBA32, false);
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                    tex.SetPixel(x, y, mask(x, y, w, h) ? color : new Color(0, 0, 0, 0));
            tex.Apply();

            string path = Sprites + "/" + name + ".png";
            File.WriteAllBytes(path, tex.EncodeToPNG());
            Object.DestroyImmediate(tex);
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);

            var ti = (TextureImporter)AssetImporter.GetAtPath(path);
            if (ti != null)
            {
                ti.textureType = TextureImporterType.Sprite;
                ti.spriteImportMode = SpriteImportMode.Single;
                ti.spritePixelsPerUnit = PPU;
                ti.alphaIsTransparency = true;
                ti.mipmapEnabled = false;
                ti.filterMode = FilterMode.Point;
                ti.isReadable = true;                 // WAJIB agar CamouflageHelper bisa baca pixel
                ti.textureCompression = TextureImporterCompression.Uncompressed;
                ti.wrapMode = TextureWrapMode.Clamp;
                ti.SaveAndReimport();
            }

            var sprite = AssetDatabase.LoadAssetAtPath<Sprite>(path);
            if (name == "white") whiteSpriteCache = sprite;
            return sprite;
        }

        private static bool CircleMask(int x, int y, int w, int h)
        {
            float cx = w * 0.5f, cy = h * 0.5f, r = w * 0.48f;
            float dx = x - cx + 0.5f, dy = y - cy + 0.5f;
            return dx * dx + dy * dy <= r * r;
        }

        private static void BackgroundColor()
        {
            Camera cam = Camera.main;
            if (cam != null) cam.backgroundColor = new Color(0.08f, 0.09f, 0.12f);
        }

        /// <summary>Set field object pada komponen (works for private + public serialized fields).</summary>
        private static void SetObj(Object target, string field, Object value)
        {
            var so = new SerializedObject(target);
            var p = so.FindProperty(field);
            if (p == null) { Debug.LogWarning("[HideSeek] field '" + field + "' tidak ditemukan pada " + target.name); return; }
            p.objectReferenceValue = value;
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        /// <summary>Set field int/LayerMask (LayerMask diserialisasi sebagai int).</summary>
        /// <summary>Set field Rect (mis. MinimapRadarView.worldBounds) lewat SerializedObject.</summary>
        private static void SetRect(Object target, string field, Rect value)
        {
            var so = new SerializedObject(target);
            var p = so.FindProperty(field);
            if (p == null || p.propertyType != SerializedPropertyType.Rect) return;
            p.rectValue = value;
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void SetInt(Object target, string field, int value)
        {
            var so = new SerializedObject(target);
            var p = so.FindProperty(field);
            if (p == null) { Debug.LogWarning("[HideSeek] field int '" + field + "' tidak ada pada " + target.name); return; }
            p.intValue = value;
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void SetStr(Object target, string field, string value)
        {
            var so = new SerializedObject(target);
            var p = so.FindProperty(field);
            if (p == null) return;
            p.stringValue = value;
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void SetBool(Object target, string field, bool value)
        {
            var so = new SerializedObject(target);
            var p = so.FindProperty(field);
            if (p == null) return;
            p.boolValue = value;
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        private static void SetArr(Object target, string field, Object[] values)
        {
            var so = new SerializedObject(target);
            var p = so.FindProperty(field);
            if (p == null || !p.isArray) return;
            p.arraySize = values.Length;
            for (int i = 0; i < values.Length; i++)
                p.GetArrayElementAtIndex(i).objectReferenceValue = values[i];
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        /// <summary>Isi PhotonView.observed (ComponentReference[]) agar OnPhotonSerializeView terpanggil.</summary>
        private static void SetObserved(PhotonView pv, Component[] components)
        {
            try
            {
                var so = new SerializedObject(pv);
                SerializedProperty observed = so.FindProperty("observed");
                if (observed == null) { Debug.LogWarning("[HideSeek] PhotonView.observed tidak ketemu; assign manual di Inspector."); return; }
                observed.arraySize = components.Length;
                for (int i = 0; i < components.Length; i++)
                {
                    SerializedProperty e = observed.GetArrayElementAtIndex(i);
                    SerializedProperty comp = e.FindPropertyRelative("component");
                    if (comp != null) comp.objectReferenceValue = components[i];
                }
                so.ApplyModifiedPropertiesWithoutUndo();
            }
            catch (System.Exception e)
            {
                Debug.LogWarning("[HideSeek] Gagal auto-assign PhotonView.observed (" + e.Message +
                                 "). Assign manual: seret PlayerController & PlayerCombat ke 'Observed Components'.");
            }
        }

        // ======================= UI BUILDERS (simple) ==========================

        private static GameObject Panel(Transform parent, string name, Color bg)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Image));
            go.transform.SetParent(parent, false);
            var rt = go.transform as RectTransform;
            rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one; rt.offsetMin = rt.offsetMax = Vector2.zero;
            go.GetComponent<Image>().color = bg;
            return go;
        }

        private static Text MakeText(Transform parent, string name, string content, int size, Vector2 anchor, Vector2 box)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Text));
            go.transform.SetParent(parent, false);
            var rt = go.transform as RectTransform;
            rt.anchorMin = rt.anchorMax = new Vector2(anchor.x, anchor.y);
            rt.pivot = new Vector2(0.5f, 0.5f);
            rt.sizeDelta = box;
            rt.anchoredPosition = Vector2.zero;
            var t = go.GetComponent<Text>();
            t.text = content;
            t.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            t.fontSize = size;
            t.alignment = TextAnchor.MiddleCenter;
            t.color = Color.white;
            t.horizontalOverflow = HorizontalWrapMode.Wrap;
            t.verticalOverflow = VerticalWrapMode.Overflow;
            return t;
        }

        private static Image MakeFilledImage(Transform parent, string name, Vector2 anchor, Vector2 box, Color c)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Image));
            go.transform.SetParent(parent, false);
            var rt = go.transform as RectTransform;
            rt.anchorMin = rt.anchorMax = new Vector2(anchor.x, anchor.y);
            rt.sizeDelta = box;
            var img = go.GetComponent<Image>();
            img.color = c;
            img.type = Image.Type.Filled;
            img.fillMethod = Image.Method.Horizontal;
            img.fillAmount = 1f;
            return img;
        }

        private static Image[] MakeHearts(Transform parent, Vector2 anchor)
        {
            var arr = new Image[HideSeekConstants.HiderMaxHp];
            var holder = new GameObject("Hearts", typeof(RectTransform), typeof(HorizontalLayoutGroup));
            holder.transform.SetParent(parent, false);
            var hrt = holder.transform as RectTransform;
            hrt.anchorMin = hrt.anchorMax = new Vector2(anchor.x, anchor.y);
            hrt.sizeDelta = new Vector2(150, 32);
            var hl = holder.GetComponent<HorizontalLayoutGroup>();
            hl.spacing = 6; hl.childAlignment = TextAnchor.MiddleLeft;
            hl.childControlWidth = false; hl.childControlHeight = false;

            for (int i = 0; i < arr.Length; i++)
            {
                var go = new GameObject("heart_" + i, typeof(RectTransform), typeof(Image));
                go.transform.SetParent(holder.transform, false);
                go.GetComponent<RectTransform>().sizeDelta = new Vector2(28, 28);
                go.GetComponent<Image>().color = Color.white;
                arr[i] = go.GetComponent<Image>();
            }
            return arr;
        }

        private static Button MakeButton(Transform parent, string name, string label, Vector2 anchor, Color c,
                                         float w = 520, float h = 84)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Image), typeof(Button));
            go.transform.SetParent(parent, false);
            var rt = go.transform as RectTransform;
            rt.anchorMin = rt.anchorMax = new Vector2(anchor.x, anchor.y);
            rt.sizeDelta = new Vector2(w, h);
            go.GetComponent<Image>().color = c;
            var b = go.GetComponent<Button>();
            b.targetGraphic = go.GetComponent<Image>();
            b.transition = Selectable.Transition.ColorTint;
            MakeText(go.transform, "Label", label, 26, new Vector2(0.5f, 0.5f), new Vector2(w - 12, h));
            return b;
        }

        private static InputField MakeInputField(Transform parent, string name, string placeholder, Vector2 anchor)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Image), typeof(InputField));
            go.transform.SetParent(parent, false);
            var rt = go.transform as RectTransform;
            rt.anchorMin = rt.anchorMax = new Vector2(anchor.x, anchor.y);
            rt.sizeDelta = new Vector2(420, 70);
            go.GetComponent<Image>().color = new Color(1f, 1f, 1f, 0.12f);

            var textGo = new GameObject("Text", typeof(RectTransform), typeof(Text));
            textGo.transform.SetParent(go.transform, false);
            var trt = textGo.transform as RectTransform;
            trt.anchorMin = Vector2.zero; trt.anchorMax = Vector2.one; trt.offsetMin = new Vector2(12, 6); trt.offsetMax = new Vector2(-12, -6);
            var txt = textGo.GetComponent<Text>();
            txt.font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            txt.fontSize = 24; txt.color = Color.white; txt.alignment = TextAnchor.MiddleLeft;
            txt.horizontalOverflow = HorizontalWrapMode.Overflow;

            var ifield = go.GetComponent<InputField>();
            ifield.textComponent = txt;
            ifield.placeholder = null;
            return ifield;
        }

        private static Toggle MakeToggle(Transform parent, string name, string label, Vector2 anchor)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Toggle), typeof(HorizontalLayoutGroup));
            go.transform.SetParent(parent, false);
            var rt = go.transform as RectTransform;
            rt.anchorMin = rt.anchorMax = new Vector2(anchor.x, anchor.y);
            rt.sizeDelta = new Vector2(300, 60);

            var check = new GameObject("Background", typeof(RectTransform), typeof(Image));
            check.transform.SetParent(go.transform, false);
            check.GetComponent<RectTransform>().sizeDelta = new Vector2(36, 36);
            check.GetComponent<Image>().color = new Color(1f, 1f, 1f, 0.2f);

            var t = go.GetComponent<Toggle>();
            t.graphic = check.GetComponent<Image>();
            t.isOn = false;
            t.targetGraphic = check.GetComponent<Image>();

            MakeText(go.transform, "Label", label, 22, new Vector2(0.5f, 0.5f), new Vector2(260, 40));
            return t;
        }

        /// <summary>Palet warna tile deterministik (agar camo mudah diuji).</summary>
        private class ColorPalette
        {
            private readonly Color[] colors;
            public ColorPalette(Color[] c) { colors = c != null && c.Length > 0 ? c : new[] { Color.white }; }
            public Color For(int x, int y)
            {
                int h = (x * 73856093) ^ (y * 19349663);
                return colors[Mathf.Abs(h) % colors.Length];
            }
        }
    }
}
#endif
