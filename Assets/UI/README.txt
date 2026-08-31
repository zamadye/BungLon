Canvas UI game (Lobby + HUD + Result).

- HideSeek_Canvas  : Canvas(Screen Space Overlay) + CanvasScaler(1080x1920, Scale With Screen Size)
  + GraphicRaycaster + UIManager + RoomListUI.
- Struktur child yang dipakai UIManager: LobbyPanel, HudPanel (phase/timer/role/hp/skills/joystick/minimap/toast),
  CountdownOverlay, ResultPanel (title/detail/leaderboard/tombol).

Semua referensi di-assign lewat Inspector (field public di UIManager & RoomListUI).
 
Field yang paling sering lupa di-assign:
- UIManager.skills            : array 2 ELEMEN (bukan 4). Element 0 = Kamuflase (Hider) / Radar (Seeker),
                                Element 1 = Prop Swap (Hider) / Sonic Blast (Seeker). Tiap elemen punya
                                hiderLabel & seekerLabel sendiri (label & ikon otomatis berganti sesuai role),
                                cooldownFill = Image dengan Image Type = Filled, Fill Method = Radial.
- UIManager.hpBar             : Image, Image Type = Filled / Fill Method = Horizontal.
- UIManager.hearts            : Image[3] (searah jumlah HP HideSeekConstants.HiderMaxHp).
- RoomListUI.playerNameInput  : opsional; kalau diisi, nama dikirim ke NetworkManager.SetPlayerName()
                                 dan disimpan di PlayerPrefs["HideSeek.PlayerNick"].
- RoomListUI.contentParent     : RectTransform + VerticalLayoutGroup + ContentSizeFitter (vertical).
- CanvasScaler                 : 1080x1920 Scale With Screen Size, Match Width or Height = 0.5
                                 (portrait). Untuk landscape ganti referensi resolution ke 1920x1080.
