// ============================================================================
//  NetworkManager.cs   (SCRIPT #1 - wajib)
//  - Connect ke Photon Cloud (atau OfflineMode untuk testing lokal).
//  - CreateRoom / JoinRoom / JoinRandom / LeaveRoom + seluruh callback PUN2.
//  - Spawn prefab pemain NETWORKED (tiap klien spawn miliknya sendiri -> pola
//    standar PUN2: ownership individual, tanpa balapan duplikat).
//  - Membuat GameRoot (GameObject persist) yang menaungi GameManager (Authority).
//
//  SETUP: taruh script ini di GameObject "NetworkManager" di scene Lobby & scene Game
//  (atau DontDestroyOnLoad). Assign playerPrefab di Inspector.
// ============================================================================
using System;
using System.Collections;
using System.Collections.Generic;
using ExitGames.Client.Photon;
using HideSeek.Core;
using HideSeek.Game;
using HideSeek.Players;
using HideSeek.UI;
using Photon.Pun;
using Photon.Realtime;
using UnityEngine;

namespace HideSeek.Network
{
    public class NetworkManager : MonoBehaviourPunCallbacks
    {
        // ============================== SINGLETON ==============================
        public static NetworkManager Instance { get; private set; }

        // ========================= INSPECTOR: CONNECTION =======================
        [Header("Koneksi")]
        [Tooltip("true = main tanpa server (beberapa Editor window / debug offline).")]
        public bool offlineMode = false;

        [Tooltip("Auto connect di Awake. Matikan bila Anda ingin connect saat tombol Play ditekan.")]
        public bool autoConnectOnAwake = true;

        [Tooltip("Setelah connect, minta daftar room ke lobby (typed lobby 'hideseek'). " +
                 "Bila dimatikan, RoomListUI hanya terisi saat tombol REFRESH ditekan.")]
        public bool joinLobbyAfterConnect = true;

        // ============================ INSPECTOR: ROOM ==========================
        [Header("Room")]
        [Tooltip("true = nama room otomatis HS-XXXXX. false = pakai RoomName di bawah.")]
        public bool useRandomRoomNames = true;

        [SerializeField] private string roomName = "HideSeekRoom";
        /// <summary>Nama room eksplisit (dipakai saat useRandomRoomNames = false / dev LAN).</summary>
        public string RoomName { get { return roomName; } set { roomName = value; } }

        [Tooltip("Nama map yang ditulis ke custom property room (ditampilkan RoomListUI).")]
        public string mapName = "Backyard";

        [Range(HideSeekConstants.RoomMinPlayers, HideSeekConstants.RoomHardCap)]
        [Tooltip("Kapasitas room. 6-12 berarti 5-11 Hider + 1 Seeker.")]
        public int maxPlayers = HideSeekConstants.RoomMaxPlayers;

        [Tooltip("Room tampil di daftar lobby (false = join by name saja).")]
        public bool listRoomInLobby = true;

        [Tooltip("JoinRandom tidak boleh masuk room yang ronde-nya sudah berjalan.")]
        public bool excludeLiveRooms = true;

        [Tooltip("Filter room yang PENUH saat cari room acak.")]
        public bool skipFullRooms = true;

        // ======================== INSPECTOR: PLAYER / SCENE ====================
        [Header("Player Prefab")]
        [Tooltip("Prefab pemain networked (wajib punya PhotonView). Nama file prefab harus sama di semua build.")]
        public GameObject playerPrefab;

        [Tooltip("true = pemain yang join saat ronde berjalan menjadi penonton (hantu).")]
        public bool lateJoinerBecomesSpectator = true;

        [Header("Spawn (Top-Down 2D)")]
        [Tooltip("Posisi spawn. Diisi manual di Inspector, atau dikosongkan (fallback: melingkar).")]
        public List<Vector2> spawnPoints = new List<Vector2>();

        [Header("Scene (untuk PhotonNetwork.LoadLevel)")]
        [Tooltip("Harus ada di Build Settings agar AutomaticallySyncScene bekerja.")]
        public string lobbySceneName = "Lobby";
        public string gameSceneName = "Game";

        // ============================== STATE/DEBUG ==============================
        [Header("Debug")]
        public bool verboseLogs = true;
        [Tooltip("true = actor number ini dianggap Authority meski bukan MasterClient (testing Editor).")]
        public bool forceHostForLocalTesting = false;
        [HideInInspector] public int forceHostActorNumber = 1;

        /// <summary>"Apakah saya yang pegang timer & state?" (Authority/Host).</summary>
        public bool IsAuthority
        {
            get
            {
                if (forceHostForLocalTesting)
                    return PhotonNetwork.LocalPlayer != null &&
                           PhotonNetwork.LocalPlayer.ActorNumber == forceHostActorNumber;
                return PhotonNetwork.IsMasterClient;
            }
        }

        /// <summary>Prefab final (hasil resolve Inspector -> Resources).</summary>
        public GameObject ResolvedPlayerPrefab { get; private set; }

        /// <summary>Room terakhir yang dibuat/di-join (untuk rejoin setelah putus koneksi).</summary>
        public string LastRoomName { get; private set; }

        /// <summary>Snapshot room list terakhir (dipakai RoomListUI & JoinRandom manual).</summary>
        public readonly List<RoomInfo> RoomListSnapshot = new List<RoomInfo>(16);

        /// <summary>Callback UI: hasil koneksi / join.</summary>
        public event Action<bool, string> OnConnectionResult;
        /// <summary>Callback UI: sudah masuk room (spawn selesai).</summary>
        public event Action OnRoomJoined;

        // ============================== LIFECYCLE ===============================
        private void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(gameObject); return; }
            Instance = this;
            DontDestroyOnLoad(gameObject);

            if (offlineMode) PhotonNetwork.OfflineMode = true;   // WAJIB sebelum connect

            // Konfigurasi global PUN2
            PhotonNetwork.AppVersion = HideSeekConstants.GameVersion;
            PhotonNetwork.AutomaticallySyncScene = true;         // host load scene -> klien ikut
            // NOTE: App ID PUN2 dibaca dari Assets/Photon/PhotonUnityNetworking/Resources/PhotonServerSettings.asset
            //       (field "App ID Realtime"). HideSeekConstants.PhotonAppId hanya dokumentasi/build script.
            if (!string.IsNullOrEmpty(HideSeekConstants.PhotonAppId))
                Log("PhotonAppId di kode = " + HideSeekConstants.PhotonAppId + " (set juga di PhotonServerSettings).");
            if (string.IsNullOrEmpty(PhotonNetwork.NickName)) PhotonNetwork.NickName = MakeNick();

            ResolvedPlayerPrefab = PrefabLibrary.Resolve(playerPrefab, HideSeekPrefabs.Player);

            if (autoConnectOnAwake) Connect();
        }

        private void OnDestroy() { if (Instance == this) Instance = null; }

        private void Update()
        {
            // Shortcut dev (matikan lewat verboseLogs): N = buat room, J = join random, L = leave.
            if (!verboseLogs) return;
            if (Input.GetKeyDown(KeyCode.N)) CreateRoom(null, false);
            else if (Input.GetKeyDown(KeyCode.J)) JoinQuickPlay();
            else if (Input.GetKeyDown(KeyCode.L)) LeaveRoom(false);
        }

        /// <summary>Nickname otomatis dari nama perangkat (aman untuk mobile).</summary>
        private static string MakeNick()
        {
            string n = SystemInfo.deviceName;
            if (string.IsNullOrEmpty(n) || n.Length < 3) n = "Player";
            if (n.Length > 12) n = n.Substring(0, 12);
            return n + "-" + UnityEngine.Random.Range(100, 999);
        }

        // ============================ PUBLIC COMMANDS ==========================

        /// <summary>Hubungkan ke Photon Cloud (App ID dibaca dari Resources/PhotonServerSettings).</summary>
        public void Connect()
        {
            if (PhotonNetwork.IsConnected) return;
            Log("ConnectUsingSettings...");
            PhotonNetwork.ConnectUsingSettings();
        }

        /// <summary>Buat room baru + tulis custom property (map, live, private, state).</summary>
        public void CreateRoom(string customName, bool isPrivate)
        {
            if (!EnsureConnected("CreateRoom")) return;
            if (PhotonNetwork.InRoom) { Log("Sudah di room " + PhotonNetwork.CurrentRoom.Name); return; }

            string name = (useRandomRoomNames || string.IsNullOrEmpty(customName))
                ? HideSeekConstants.RoomNamePrefix + Guid.NewGuid().ToString("N").Substring(0, 5).ToUpperInvariant()
                : customName;

            // Property yang ditulis ke room. Kunci2 ini dibaca GameManager (state) & RoomListUI.
            var props = new Hashtable
            {
                { HideSeekConstants.PropMapName, mapName },
                { HideSeekConstants.PropIsLive, false },
                { HideSeekConstants.PropIsPrivate, isPrivate },
                { HideSeekConstants.PropState, (byte)GameState.Lobby },
                { HideSeekConstants.PropStateRemain, 0f },
                { HideSeekConstants.PropRound, 0 },
                { HideSeekConstants.PropWinner, (byte)WinnerType.None },
                { HideSeekConstants.PropWinnerActor, 0 }
            };

            var options = new RoomOptions
            {
                MaxPlayers = (byte)Mathf.Clamp(maxPlayers, HideSeekConstants.RoomMinPlayers, HideSeekConstants.RoomHardCap),
                IsOpen = true,
                IsVisible = listRoomInLobby && !isPrivate,
                EmptyRoomTtl = 5000,     // beri waktu 5 detik sebelum room dihapus bila semua keluar
                PlayerTtl = 10000,       // pemain mobile yang putus WiFi punya 10 detik untuk reconnect
                CustomRoomProperties = props,
                // Hanya property yang perlu di-match/filter yang dikirim ke lobby (hemat bandwidth).
                CustomRoomPropertiesForLobby = new string[]
                {
                    HideSeekConstants.PropMapName,
                    HideSeekConstants.PropIsLive,
                    HideSeekConstants.PropIsPrivate
                }
            };

            Log("CreateRoom '" + name + "' max=" + options.MaxPlayers + " private=" + isPrivate);
            PhotonNetwork.CreateRoom(name, options, GetTypedLobby());
        }

        /// <summary>Join ke room dengan nama tertentu (tombol Join di RoomListUI).</summary>
        public void JoinRoomByName(string targetRoomName)
        {
            if (!EnsureConnected("JoinRoomByName")) return;
            if (string.IsNullOrEmpty(targetRoomName)) { Warn("JoinRoomByName: nama room kosong."); return; }
            Log("JoinRoom '" + targetRoomName + "'");
            PhotonNetwork.JoinRoom(targetRoomName);
        }

        /// <summary>
        /// Quick Play: pilih room paling cocok dari snapshot lobby (hemat 1 RTT dibanding
        /// JoinRandom), kalau tidak ada -> buat room sendiri.
        /// </summary>
        public void JoinQuickPlay()
        {
            if (!EnsureConnected("JoinQuickPlay")) return;

            RoomInfo best = FindBestRoom();
            if (best != null)
            {
                Log("QuickPlay -> join '" + best.Name + "' (" + best.PlayerCount + "/" + best.MaxPlayers + ")");
                JoinRoomByName(best.Name);
                return;
            }
            // Snapshot lobby kosong / basi -> minta matchmaking Photon, dan bila gagal
            // OnJoinRandomFailed akan membuat room baru.
            if (PhotonNetwork.IsConnectedAndReady && !PhotonNetwork.InRoom && RoomListSnapshot.Count == 0)
            {
                Log("QuickPlay -> snapshot lobby kosong, pakai PhotonNetwork.JoinRandomRoom().");
                PhotonNetwork.JoinRandomRoom();
                return;
            }
            Log("QuickPlay -> tidak ada room cocok, buat room baru.");
            CreateRoom(null, false);
        }

        /// <summary>Cari room terbaik pada snapshot lobby (open, belum live, belum penuh).</summary>
        private RoomInfo FindBestRoom()
        {
            RoomInfo best = null;
            for (int i = 0; i < RoomListSnapshot.Count; i++)
            {
                RoomInfo r = RoomListSnapshot[i];
                if (r == null || !r.IsVisible || !r.IsOpen || r.IsClosed) continue;
                if (HideSeekConstants.GetProp(r.CustomProperties, HideSeekConstants.PropIsPrivate, false)) continue;
                if (excludeLiveRooms && HideSeekConstants.GetProp(r.CustomProperties, HideSeekConstants.PropIsLive, false)) continue;
                if (skipFullRooms && r.PlayerCount >= r.MaxPlayers) continue;
                if (r.RemovedFromList) continue;

                // Prioritaskan room yang paling terisi (menghemat CCU) tapi belum penuh.
                if (best == null || r.PlayerCount > best.PlayerCount) best = r;
            }
            return best;
        }

        /// <summary>Keluar room. <paramref name="backToLobbyScene"/> = ikut reload scene lobby.</summary>
        public void LeaveRoom(bool backToLobbyScene)
        {
            if (!PhotonNetwork.InRoom)
            {
                if (backToLobbyScene) LoadScene(lobbySceneName);
                return;
            }
            pendingLobbyScene = backToLobbyScene;
            PhotonNetwork.LeaveRoom();
        }

        private bool pendingLobbyScene;

        /// <summary>Refresh daftar room: re-join lobby memicu OnRoomListUpdate baru.</summary>
        public void RefreshRoomList()
        {
            if (!PhotonNetwork.IsConnectedAndReady || PhotonNetwork.InRoom) return;
            PhotonNetwork.JoinLobby(GetTypedLobby());
        }

        /// <summary>Status ringkas untuk UI (connect / lobby / in room).</summary>
        public string ConnectionStatus
        {
            get
            {
                if (PhotonNetwork.InRoom) return "Room: " + PhotonNetwork.CurrentRoom.Name;
                if (PhotonNetwork.IsConnectedAndReady) return "Online - Lobby";
                if (PhotonNetwork.IsConnected) return "Connecting...";
                return offlineMode ? "Offline Mode" : "Disconnected";
            }
        }

        // ========================== PHOTON CALLBACKS ============================

        public override void OnConnected() { Log("OnConnected (name server)."); }

        /// <summary>Sudah di master: boleh Create/Join. Sekalian minta daftar room.</summary>
        public override void OnConnectedToMaster()
        {
            Log("OnConnectedToMaster.");
            Emit(true, "Terhubung ke Photon Cloud");
            if (joinLobbyAfterConnect && !PhotonNetwork.InRoom) RefreshRoomList();
        }

        /// <summary>
        /// Terputus. Untuk mobile ini sering terjadi (ganti jaringan) -> retry dengan backoff,
        /// dan bila sedang di room, coba rejoin room yang sama (PlayerTtl memberi jendela).
        /// </summary>
        public override void OnDisconnected(DisconnectCause cause)
        {
            Warn("OnDisconnected: " + cause);
            Emit(false, "Terputus: " + cause);
            PlayerRegistry.Clear();
            if (GameManager.Instance != null) GameManager.Instance.OnDisconnectedFromGame(cause);

            // Disconnect oleh kode (tombol Quit) -> jangan auto reconnect.
            if (cause == DisconnectCause.DisconnectByClientLogic) StopAllCoroutines();
            else StartCoroutine(CoroutineReconnect());
        }

        /// <summary>Room berhasil dibuat = kita Host/Authority (dipanggil sebelum OnJoinedRoom).</summary>
        public override void OnCreatedRoom()
        {
            LastRoomName = PhotonNetwork.CurrentRoom != null ? PhotonNetwork.CurrentRoom.Name : LastRoomName;
            Log("OnCreatedRoom: " + LastRoomName + " -> saya Authority (host).");
        }

        public override void OnCreateRoomFailed(short returnCode, string message)
        {
            Warn("OnCreateRoomFailed rc=" + returnCode + " :: " + message);
            Emit(false, "Gagal buat room: " + message);
        }

        /// <summary>
        /// Berhasil masuk room: spawn pemain LOKAL (pola standar PUN2 - tiap klien instantiate
        /// miliknya sendiri, Photon mengirim Instantiate event ke klien lain).
        /// </summary>
        public override void OnJoinedRoom()
        {
            Room r = PhotonNetwork.CurrentRoom;
            Log("OnJoinedRoom: " + r.Name + " players=" + r.PlayerCount + "/" + r.MaxPlayers +
                " authority=" + PhotonNetwork.IsMasterClient);

            EnsureGameRoot();
            SpawnLocalPlayer(r);

            if (OnRoomJoined != null) OnRoomJoined();
            if (GameManager.Instance != null) GameManager.Instance.OnLocalJoinedRoom();
        }

        public override void OnJoinRoomFailed(short returnCode, string message)
        {
            Warn("OnJoinRoomFailed rc=" + returnCode + " :: " + message);
            Emit(false, "Gagal join: " + message);
            RefreshRoomList();
        }

        /// <summary>Tidak ada room kosong saat JoinRandom -> buat room sendiri.</summary>
        public override void OnJoinRandomFailed(short returnCode, string message)
        {
            Log("OnJoinRandomFailed (" + message + ") -> membuat room baru.");
            CreateRoom(null, false);
        }

        public override void OnLeftRoom()
        {
            Log("OnLeftRoom.");
            PlayerRegistry.Clear();
            if (GameManager.Instance != null) GameManager.Instance.ResetAllStates();
            if (pendingLobbyScene) { pendingLobbyScene = false; LoadScene(lobbySceneName); }
            RefreshRoomList();
        }

        public override void OnPlayerEnteredRoom(Player newPlayer)
        {
            Log("Player masuk: " + newPlayer.NickName + " (#" + newPlayer.ActorNumber + ")");
            if (GameManager.Instance != null) GameManager.Instance.OnPlayerCountChanged();
        }

        public override void OnPlayerLeftRoom(Player otherPlayer)
        {
            Log("Player keluar: " + otherPlayer.NickName + " (#" + otherPlayer.ActorNumber + ")");
            PlayerRegistry.Unregister(otherPlayer.ActorNumber, null);
            // Catatan: Photon otomatis menghancurkan instantiated objects milik player yang keluar.
            if (GameManager.Instance != null) GameManager.Instance.OnPlayerCountChanged();
        }

        /// <summary>Host keluar/putus -> Photon memilih master baru; GameManager ambil alih timer.</summary>
        public override void OnMasterClientSwitched(Player newMasterClient)
        {
            Log("OnMasterClientSwitched -> " + (newMasterClient != null ? newMasterClient.NickName : "null"));
            if (GameManager.Instance != null) GameManager.Instance.OnAuthorityChanged();
            StartCoroutine(CoroutineRepairPlayerObjects());
        }

        /// <summary>Daftar room dari lobby -> diteruskan ke RoomListUI.</summary>
        public override void OnRoomListUpdate(List<RoomInfo> roomList)
        {
            if (roomList == null) return;
            for (int i = 0; i < roomList.Count; i++)
            {
                RoomInfo info = roomList[i];
                if (info == null) continue;
                int idx = IndexOfRoom(info.Name);
                if (info.RemovedFromList) { if (idx >= 0) RoomListSnapshot.RemoveAt(idx); }
                else if (idx >= 0) RoomListSnapshot[idx] = info;
                else RoomListSnapshot.Add(info);
            }
            if (verboseLogs) Log("OnRoomListUpdate: " + RoomListSnapshot.Count + " room tersedia.");
            if (RoomListUI.Instance != null) RoomListUI.Instance.UpdateRoomList(RoomListSnapshot);
        }

        public override void OnJoinedLobby() { Log("OnJoinedLobby (typed: " + HideSeekConstants.LobbyName + ")."); }

        // ============================== HELPERS =================================

        /// <summary>Instantiate pemain lokal + konfigurasi awal (nick, spectator bila late join).</summary>
        private void SpawnLocalPlayer(Room r)
        {
            if (ResolvedPlayerPrefab == null)
            {
                Warn("playerPrefab kosong dan Resources/HideSeek/" + HideSeekPrefabs.Player +
                     " tidak ditemukan. Jalankan menu: HideSeek > Setup > Generate Placeholder Assets.");
                return;
            }

            Player me = PhotonNetwork.LocalPlayer;
            Vector3 pos = GetSpawnPosition(me.ActorNumber, r.PlayerCount);

            int groupOwner = 0;   // 0 = ownership individual (creator = owner) -> pola standar PUN2
            GameObject go = PhotonNetwork.Instantiate(PrefabLibrary.NetName(ResolvedPlayerPrefab),
                                                       pos, Quaternion.identity, groupOwner);
            if (go == null) { Warn("PhotonNetwork.Instantiate() mengembalikan null (prefab tidak terdaftar?)."); return; }

            var pc = go.GetComponent<PlayerController>();
            if (pc != null && lateJoinerBecomesSpectator &&
                GameManager.Instance != null && GameManager.Instance.IsRoundRunning)
            {
                pc.SetSpectator(true);
            }
            Log("Spawn player lokal: " + go.name + " @ " + pos);
        }

        /// <summary>Posisi spawn: pakai list Inspector (round robin), jika kosong -> melingkar.</summary>
        public Vector3 GetSpawnPosition(int actorNumber, int playerCountInRoom)
        {
            if (spawnPoints != null && spawnPoints.Count > 0)
                return spawnPoints[Mathf.Abs(actorNumber) % spawnPoints.Count];

            int n = Mathf.Max(2, playerCountInRoom);
            float ang = (Mathf.Abs(actorNumber) % n) * (Mathf.PI * 2f / n);
            return new Vector3(Mathf.Cos(ang) * 3.5f, Mathf.Sin(ang) * 3.5f, 0f);
        }

        /// <summary>Buat GameObject tempat GameManager (Authority) tinggal - persist antar scene.</summary>
        private void EnsureGameRoot()
        {
            if (GameManager.Instance != null) return;
            var go = new GameObject("HideSeek_GameRoot");
            DontDestroyOnLoad(go);
            go.AddComponent<GameManager>();
            Log("HideSeek_GameRoot + GameManager dibuat.");
        }

        /// <summary>
        /// Setelah host berganti, objek pemain dari host lama mungkin owner-nya hilang.
        /// Kita tidak recreate (bisa duplikat); hanya memastikan registry bersih.
        /// </summary>
        private IEnumerator CoroutineRepairPlayerObjects()
        {
            yield return new WaitForSeconds(1f);
            PlayerRegistry.RefreshLivingHiders();
        }

        private IEnumerator CoroutineReconnect()
        {
            for (int attempt = 1; attempt <= 4 && !PhotonNetwork.IsConnectedAndReady; attempt++)
            {
                float wait = Mathf.Min(8f, 1.5f * attempt);
                Log("Reconnect attempt " + attempt + " dalam " + wait + "s ...");
                yield return new WaitForSeconds(wait);
                if (PhotonNetwork.OfflineMode) yield break;
                PhotonNetwork.ConnectUsingSettings();

                if (PhotonNetwork.IsConnectedAndReady && !string.IsNullOrEmpty(LastRoomName))
                {
                    Log("Reconnect OK -> rejoin " + LastRoomName);
                    PhotonNetwork.JoinRoom(LastRoomName);
                }
            }
        }

        private int IndexOfRoom(string name)
        {
            for (int i = 0; i < RoomListSnapshot.Count; i++)
                if (RoomListSnapshot[i] != null && RoomListSnapshot[i].Name == name) return i;
            return -1;
        }

        private TypedLobby GetTypedLobby()
        {
            return new TypedLobby(HideSeekConstants.LobbyName, LobbyType.Default);
        }

        private bool EnsureConnected(string op)
        {
            if (PhotonNetwork.OfflineMode || PhotonNetwork.IsConnectedAndReady) return true;
            Warn("[" + op + "] belum IsConnectedAndReady. Mencoba connect...");
            Connect();
            return false;
        }

        /// <summary>Load scene; bila di dalam room, pakai PhotonNetwork.LoadLevel agar semua klien ikut.</summary>
        public void LoadScene(string sceneName)
        {
            if (string.IsNullOrEmpty(sceneName)) return;
            if (PhotonNetwork.InRoom && PhotonNetwork.IsMasterClient) PhotonNetwork.LoadLevel(sceneName);
            else if (!PhotonNetwork.InRoom) UnityEngine.SceneManagement.SceneManager.LoadScene(sceneName);
        }

        private void Log(string msg) { if (verboseLogs) Debug.Log("[HideSeek/Net] " + msg, this); }
        private void Warn(string msg) { Debug.LogWarning("[HideSeek/Net] " + msg, this); }

        private void Emit(bool ok, string msg)
        {
            if (OnConnectionResult != null) OnConnectionResult(ok, msg);
            if (UIManager.Instance != null) UIManager.Instance.ShowToast(msg);
        }
    }
}
