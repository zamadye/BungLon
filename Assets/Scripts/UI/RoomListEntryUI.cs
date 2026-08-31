// ============================================================================
//  RoomListEntryUI.cs
//  Satu baris daftar room (dipakai RoomListUI). Buat prefab berisi:
//    GameObject "RoomEntry" (root: Image + Button + RoomListEntryUI)
//      |- Name     (Text)
//      |- Info     (Text)   -> "4/8  -  Backyard"
//      |- Status   (Text)   -> "LOBBY" / "LIVE" / "PRIVATE"
//    lalu assign prefab-nya ke RoomListUI.entryPrefab.
// ============================================================================
using System;
using HideSeek.Core;
using HideSeek.Network;
using Photon.Realtime;
using UnityEngine;
using UnityEngine.UI;

namespace HideSeek.UI
{
    [RequireComponent(typeof(Button))]
    public class RoomListEntryUI : MonoBehaviour
    {
        [Header("Referensi (assign manual di prefab)")]
        public Text roomNameText;
        public Text playersText;
        public Text mapText;
        public Text statusText;
        public Button joinButton;
        public Image statusIcon;

        /// <summary>Nama room yang akan dipakai saat tombol Join ditekan.</summary>
        public string RoomName { get; private set; }

        private RoomListUI owner;
        private RoomInfo cached;

        private void Awake()
        {
            if (joinButton == null) joinButton = GetComponent<Button>();
            if (joinButton != null)
            {
                joinButton.onClick.RemoveAllListeners();
                joinButton.onClick.AddListener(OnJoinClicked);
            }
        }

        /// <summary>Isi data baris. Dipanggil dari RoomListUI saat daftar room diterima.</summary>
        public void Setup(RoomListUI listOwner, RoomInfo info)
        {
            owner = listOwner;
            cached = info;
            if (info == null) { gameObject.SetActive(false); return; }
            gameObject.SetActive(true);

            RoomName = info.Name;

            string map = HideSeekConstants.GetProp(info.CustomProperties, HideSeekConstants.PropMapName, "?");
            bool live = HideSeekConstants.GetProp(info.CustomProperties, HideSeekConstants.PropIsLive, false);
            bool priv = HideSeekConstants.GetProp(info.CustomProperties, HideSeekConstants.PropIsPrivate, false);

            if (roomNameText != null) roomNameText.text = priv ? ("[KUNCI] " + info.Name) : info.Name;
            if (playersText != null) playersText.text = info.PlayerCount + "/" + info.MaxPlayers + " pemain";
            if (mapText != null) mapText.text = "Map: " + map;

            string status = live ? "SEDANG MAIN" : (info.IsOpen ? "BUKA" : "PENUH");
            Color color = live ? new Color(1f, 0.55f, 0.2f) : (info.IsOpen ? new Color(0.35f, 0.9f, 0.45f) : Color.gray);

            if (statusText != null) { statusText.text = status; statusText.color = color; }
            if (statusIcon != null) statusIcon.color = color;

            bool canJoin = info.IsOpen && !info.IsClosed && (!owner || !owner.BlockLiveRooms || !live);
            if (joinButton != null) joinButton.interactable = canJoin;
        }

        /// <summary>Tombol Join -> NetworkManager.JoinRoomByName.</summary>
        private void OnJoinClicked()
        {
            if (string.IsNullOrEmpty(RoomName)) return;
            if (cached != null && !cached.IsOpen)
            {
                if (UIManager.Instance != null) UIManager.Instance.ShowToast("Room sudah penuh/tertutup.");
                return;
            }
            if (NetworkManager.Instance != null)
            {
                if (UIManager.Instance != null) UIManager.Instance.ShowToast("Menggabungkan ke " + RoomName + "...");
                NetworkManager.Instance.JoinRoomByName(RoomName);
            }
        }
    }
}
