Canvas UI game (Lobby + HUD + Result).

- HideSeek_Canvas  : Canvas(Screen Space Overlay) + CanvasScaler(1080x1920, Scale With Screen Size)
  + GraphicRaycaster + UIManager + RoomListUI.
- Struktur child yang dipakai UIManager: LobbyPanel, HudPanel (phase/timer/role/hp/skills/joystick/minimap/toast),
  CountdownOverlay, ResultPanel (title/detail/leaderboard/tombol).

Semua referensi di-assign lewat Inspector (field public di UIManager & RoomListUI).
 
