// ============================================================================
//  RoomListUI.cs   (SCRIPT #10 - wajib)
//  Menampilkan daftar room yang tersedia (di-supply oleh NetworkManager via
//  Photon OnRoomListUpdate) + tombol JOIN per room + tombol CREATE / QUICK /
//  REFRESH + input nama room & opsi room privat.
//
//  SETUP (assign manual di Inspector):
//    contentParent  : RectTransform dengan VerticalLayoutGroup + ContentSizeFitter.
//    entryPrefab    : prefab RoomListEntryUI (lihat file tersebut).
//    roomNameInput  : opsional, untuk nama room custom saat Create.
//    privateToggle  : opsional, untuk membuat room terkunci.
//  Tidak ada referensi pun -> tetap aman (semua null-safe), hanya list tidak muncul.
// ============================================================================
using System.Collections.Generic;
using HideSeek.Core;
using HideSeek.Network;
using Photon.Pun;
using Photon.Realtime;
using UnityEngine;
using UnityEngine.UI;

namespace HideSeek.UI
{
    [DisallowMultipleComponent]
    public class RoomListUI : MonoBehaviour
    {
        public static RoomListUI Instance { get; private set; }

        // ============================ INSPECTOR ================================
        [Header("Referensi UI (assign manual)")]
        [Tooltip("Parent baris room (pakai VerticalLayoutGroup).")]
        public RectTransform contentParent;

        [Tooltip("Prefab baris room (harus berisi komponen RoomListEntryUI).")]
        public RoomListEntryUI entryPrefab;

        [Tooltip("Teks saat daftar kosong.")]
        public Text emptyText;

        [Tooltip("Teks status koneksi (Online / Connecting / Offline).")]
        public Text headerText;

        [Header("Input Create Room")]
        [Tooltip("Nama room custom (kosong = otomatis HS-XXXXX).")]
        public InputField roomNameInput;
        [Tooltip("Centang = room privat (tidak muncul di lobby, join by name).")]
        public Toggle privateToggle;
        [Tooltip("Slider kapasitas room saat Create (opsional).")]
        public Dropdown maxPlayersDropdown;

        [Header("Tombol")]
        public Button createButton;
        public Button quickJoinButton;
        public Button refreshButton;
        public Button joinByCodeButton;

        [Header("Filter & perilaku")]
        [Tooltip("Sembunyikan room yang sudah penuh.")]
        public bool hideFullRooms = true;

        [Tooltip("Sembunyikan room yang sedang main (IsLive). Bila false, tampil tapi tombol Join nonaktif.")]
        public bool blockLiveRooms = true;

        [Tooltip("Tampilkan room privat di daftar? (default false, karena privat tidak pernah IsVisible)")]
        public bool showPrivateRooms = false;

        [Tooltip("Batas baris yang dibuat (hemat draw call di mobile).")]
        [Range(1, 50)] public int maxEntries = 20;

        [Tooltip("Refresh otomatis tiap N detik. 0 = hanya saat tombol ditekan / saat callbackPhoton.")]
        public float autoRefreshInterval = 5f;

        [Tooltip("Urutkan: true = room paling penuh duluan (hemat CCU), false = nama A-Z.")]
        public bool preferMostFilled = true;

        // =============================== STATE =================================
        private readonly List<RoomListEntryUI> pool = new List<RoomListEntryUI>(maxEntries);
        private readonly List<RoomInfo> filtered = new List<RoomInfo>(maxEntries);
        private float nextRefresh;
        private bool wired;

        /// <summary>Bila true, baris room yang sedang main tidak bisa di-join (dipakai RoomListEntryUI).</summary>
        public bool BlockLiveRooms { get { return blockLiveRooms; } }

        // ============================== LIFECYCLE ===============================
        private void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(gameObject); return; }
            Instance = this;
            WireButtons();
            BuildDropdownIfAssigned();
        }

        private void OnDestroy() { if (Instance == this) Instance = null; }

        private void OnEnable()
        {
            nextRefresh = 0f;
            if (NetworkManager.Instance != null)
            {
                // Gunakan snapshot yang sudah dipegang NetworkManager (hemat request berulang).
                UpdateRoomList(NetworkManager.Instance.RoomListSnapshot);
                NetworkManager.Instance.RefreshRoomList();
            }
        }

        private void Update()
        {
            if (autoRefreshInterval > 0f && Time.time >= nextRefresh)
            {
                nextRefresh = Time.time + Mathf.Max(1f, autoRefreshInterval);
                if (NetworkManager.Instance != null && !PhotonNetwork.InRoom)
                    NetworkManager.Instance.RefreshRoomList();
            }
            if (headerText != null && NetworkManager.Instance != null)
                headerText.text = NetworkManager.Instance.ConnectionStatus;
        }

        // ============================ PUBLIC CALLBACK ============================

        /// <summary>
        /// Dipanggil dari NetworkManager.OnRoomListUpdate. Membangun ulang baris dari
        /// daftar RoomInfo (filter -> urut -> batasi -> isi prefab baris).
        /// </summary>
        public void UpdateRoomList(List<RoomInfo> rooms)
        {
            if (contentParent == null) return;

            filtered.Clear();
            if (rooms != null)
            {
                for (int i = 0; i < rooms.Count && filtered.Count < maxEntries; i++)
                {
                    RoomInfo r = rooms[i];
                    if (r == null || r.RemovedFromList) continue;
                    if (!r.IsVisible && !showPrivateRooms) continue;
                    if (hideFullRooms && r.PlayerCount >= r.MaxPlayers) continue;

                    bool live = HideSeekConstants.GetProp(r.CustomProperties, HideSeekConstants.PropIsLive, false);
                    if (blockLiveRooms && live) continue;

                    bool priv = HideSeekConstants.GetProp(r.CustomProperties, HideSeekConstants.PropIsPrivate, false);
                    if (priv && !showPrivateRooms) continue;

                    filtered.Add(r);
                }
            }

            // Pengurutan (tanpa LINQ agar ringan di mobile/IL2CPP).
            filtered.Sort(delegate (RoomInfo a, RoomInfo b)
            {
                if (preferMostFilled)
                {
                    int c = b.PlayerCount.CompareTo(a.PlayerCount);
                    if (c != 0) return c;
                }
                return string.Compare(a.Name, b.Name, System.StringComparison.OrdinalIgnoreCase);
            });

            for (int i = 0; i < pool.Count; i++)
                if (pool[i] != null) pool[i].gameObject.SetActive(i < filtered.Count);

            for (int i = 0; i < filtered.Count; i++)
            {
                RoomListEntryUI entry = EnsureEntry(i);
                if (entry != null) entry.Setup(this, filtered[i]);
            }

            if (emptyText != null)
            {
                emptyText.gameObject.SetActive(filtered.Count == 0);
                emptyText.text = (rooms != null && rooms.Count > 0)
                    ? "Tidak ada room yang cocok dengan filter (coba matikan filter / buat room baru)."
                    : "Belum ada room. Tekan CREATE ROOM untuk mulai.";
            }
        }

        /// <summary>Tombol refresh: minta daftar baru ke Photon (lewat lobby re-join).</summary>
        public void RefreshNow()
        {
            if (NetworkManager.Instance != null) NetworkManager.Instance.RefreshRoomList();
            nextRefresh = Time.time + Mathf.Max(1f, autoRefreshInterval);
            if (UIManager.Instance != null) UIManager.Instance.ShowToast("Memperbarui daftar room...");
        }

        // ============================== CREATE ROOM ==============================

        /// <summary>Buat room dari nilai input UI (nama, privat, kapasitas).</summary>
        public void CreateRoomFromUI()
        {
            NetworkManager nm = NetworkManager.Instance;
            if (nm == null) { Toast("NetworkManager belum ada di scene."); return; }

            string name = roomNameInput != null ? roomNameInput.text.Trim() : "";
            bool isPrivate = privateToggle != null && privateToggle.isOn;

            int cap = nm.maxPlayers;
            if (maxPlayersDropdown != null && maxPlayersDropdown.options != null &&
                maxPlayersDropdown.value >= 0 && maxPlayersDropdown.options.Count > maxPlayersDropdown.value)
            {
                int.TryParse(maxPlayersDropdown.options[maxPlayersDropdown.value].text, out cap);
            }
            cap = Mathf.Clamp(cap <= 0 ? HideSeekConstants.RoomMaxPlayers : cap,
                              HideSeekConstants.RoomMinPlayers, HideSeekConstants.RoomHardCap);
            nm.maxPlayers = cap;

            nm.CreateRoom(string.IsNullOrEmpty(name) ? null : name, isPrivate);
            Toast("Membuat room (" + cap + " pemain)...");
        }

        /// <summary>Join by name/code (untuk room privat yang tidak muncul di lobby).</summary>
        public void JoinByCode()
        {
            if (roomNameInput == null || string.IsNullOrEmpty(roomNameInput.text))
            {
                Toast("Isi nama room / kode terlebih dahulu.");
                return;
            }
            if (NetworkManager.Instance != null)
                NetworkManager.Instance.JoinRoomByName(roomNameInput.text.Trim());
        }

        // ================================ HELPERS ===============================

        /// <summary>Ambil/buat baris ke-i (pooling: tidak ada Instantiate berulang).</summary>
        private RoomListEntryUI EnsureEntry(int index)
        {
            while (pool.Count <= index)
            {
                RoomListEntryUI e = null;
                if (entryPrefab != null)
                {
                    e = Instantiate(entryPrefab, contentParent);
                }
                else
                {
                    // Fallback: baris teks sederhana supaya daftar tetap terbaca tanpa prefab.
                    e = BuildFallbackEntry();
                }
                if (e == null) return null;
                pool.Add(e);
            }
            var entry = pool[index];
            if (entry != null) entry.gameObject.SetActive(true);
            return entry;
        }

        /// <summary>Baris darurat (tanpa prefab): Image + 3 Text + Button.</summary>
        private RoomListEntryUI BuildFallbackEntry()
        {
            var go = new GameObject("RoomEntry", typeof(RectTransform), typeof(Image), typeof(Button),
                                    typeof(RoomListEntryUI), typeof(HorizontalLayoutGroup), typeof(LayoutElement));
            go.transform.SetParent(contentParent, false);

            var img = go.GetComponent<Image>();
            img.color = new Color(1f, 1f, 1f, 0.08f);

            var h = go.GetComponent<HorizontalLayoutGroup>();
            h.childAlignment = TextAnchor.MiddleLeft;
            h.spacing = 10;
            h.padding = new RectOffset(10, 10, 4, 4);
            h.childControlWidth = true; h.childForceExpandWidth = true;
            h.childControlHeight = true; h.childForceExpandHeight = true;
            go.GetComponent<LayoutElement>().minHeight = 44;

            Text nameT = CreateText(go.transform, "Name", 3.4f);
            Text playersT = CreateText(go.transform, "Players", 1.6f);
            Text statusT = CreateText(go.transform, "Status", 1.2f);

            var btnGo = new GameObject("JoinBtn", typeof(RectTransform), typeof(Image), typeof(Button), typeof(LayoutElement));
            btnGo.transform.SetParent(go.transform, false);
            btnGo.GetComponent<LayoutElement>().flexibleWidth = 1f;
            btnGo.GetComponent<LayoutElement>().minWidth = 70;
            btnGo.GetComponent<Image>().color = new Color(0.2f, 0.7f, 0.35f, 0.9f);
            CreateText(btnGo.transform, "Label", 1f).text = "JOIN";

            var e = go.GetComponent<RoomListEntryUI>();
            e.roomNameText = nameT;
            e.playersText = playersT;
            e.statusText = statusT;
            e.joinButton = btnGo.GetComponent<Button>();
            return e;
        }

        private static Text CreateText(Transform parent, string name, float flexible)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Text), typeof(LayoutElement));
            go.transform.SetParent(parent, false);
            var t = go.GetComponent<Text>();
            t.text = "-";
            t.fontSize = 20;
            t.alignment = TextAnchor.MiddleLeft;
            t.color = Color.white;
            t.horizontalOverflow = HorizontalWrapMode.Overflow;
            var le = go.GetComponent<LayoutElement>();
            le.flexibleWidth = flexible;
            return t;
        }

        private void WireButtons()
        {
            if (wired) return;
            wired = true;
            if (createButton != null) createButton.onClick.AddListener(CreateRoomFromUI);
            if (refreshButton != null) refreshButton.onClick.AddListener(RefreshNow);
            if (quickJoinButton != null && NetworkManager.Instance != null)
                quickJoinButton.onClick.AddListener(delegate { if (NetworkManager.Instance != null) NetworkManager.Instance.JoinQuickPlay(); });
            if (joinByCodeButton != null) joinByCodeButton.onClick.AddListener(JoinByCode);
        }

        /// <summary>Isi dropdown kapasitas dengan angka yang diizinkan (2..12 default).</summary>
        private void BuildDropdownIfAssigned()
        {
            if (maxPlayersDropdown == null || maxPlayersDropdown.options == null || maxPlayersDropdown.options.Count > 0) return;
            maxPlayersDropdown.ClearOptions();
            var opts = new List<Dropdown.OptionData>();
            for (int i = HideSeekConstants.RoomMinPlayers; i <= HideSeekConstants.RoomMaxPlayers; i++)
                opts.Add(new Dropdown.OptionData(i.ToString()));
            maxPlayersDropdown.AddOptions(opts);
            maxPlayersDropdown.value = Mathf.Clamp(8 - HideSeekConstants.RoomMinPlayers, 0, opts.Count - 1);
            maxPlayersDropdown.RefreshShownValue();
        }

        private static void Toast(string msg)
        {
            if (UIManager.Instance != null) UIManager.Instance.ShowToast(msg);
        }
    }
}
