// ============================================================================
//  HideSeekConstants.cs
//  Semua konstanta global (network, gameplay, layer) dipakai lintas script.
//  Menaruh nilai di satu tempat membuat tuning mudah & mencegah "magic string".
// ============================================================================
using ExitGames.Client.Photon;   // RaiseEventOptions, SendOptions, Hashtable
using Photon.Pun;               // PhotonNetwork
using Photon.Realtime;          // ReceiverGroup
using UnityEngine;              // Vector2, Mathf

namespace HideSeek.Core
{
    /// <summary>Pemenang ronde (ditulis ke room property + panel result).</summary>
    public enum WinnerType : byte
    {
        None = 0,
        Hiders = 1,
        Seeker = 2
    }

    /// <summary>Role pemain yang di-assign oleh Host (Authority) saat COUNTDOWN.</summary>
    public enum GameRole : byte
    {
        None = 0,
        Hider = 1,
        Seeker = 2
    }

    /// <summary>
    /// State machine utama game.
    /// LOBBY -> COUNTDOWN(5s) -> HIDE_PHASE(30s) -> SEEK_PHASE(60s) -> RESULT(10s) -> COUNTDOWN lagi.
    /// </summary>
    public enum GameState : byte
    {
        Lobby = 0,
        Countdown = 1,
        HidePhase = 2,
        SeekPhase = 3,
        Result = 4
    }

    /// <summary>Nilai-nilai yang tidak berubah saat runtime (network config + balancing).</summary>
    public static class HideSeekConstants
    {
        // ------------------------------------------------------------------
        // PHOTON / NETWORK
        // ------------------------------------------------------------------

        /// <summary>
        /// App ID PUN2 "Realtime".
        /// Di-isi dari PhotonDashboard (Project -> Realtime -> App ID).
        /// Jika string ini masih kosong, NetworkManager akan memakai nilai pada
        /// Resources/PhotonServerSettings.asset (cara yang lebih umum).
        /// </summary>
        public const string PhotonAppId = "";

        /// <summary>Nama typed lobby. Typed lobby memisahkan room list game ini dari project lain.</summary>
        public const string LobbyName = "hideseek";

        /// <summary>Prefix nama room (CreateRoom -> "HS_abc123").</summary>
        public const string RoomNamePrefix = "HS_";

        /// <summary>
        /// Version string: player dengan beda "gameVersion" tidak akan match saat JoinRandom.
        /// Naikkan angka ini setiap kali mengubah ruleset/prefab agar klien lama tidak gabung.
        /// </summary>
        public const string GameVersion = "1.0.0";

        /// <summary>
        /// SendRate minimal (ms) supaya tidak boros bandwidth di mobile.
        /// 50ms = 20Hz, cukup untuk 2D top-down + interpolation di sisi receiver.
        /// </summary>
        public const int MinSendRateMs = 50;

        /// <summary>Interval heartbeat timer dari Host ke seluruh room (detik).</summary>
        public const float TimerBroadcastInterval = 0.25f;

        // ------------------------------------------------------------------
        // KEYPATH ROOM CUSTOM PROPERTIES (harus di-register di RoomOptions!)
        // ------------------------------------------------------------------
        public const string PropMapName = "Map";           // string  : nama peta
        public const string PropIsLive = "Live";           // bool    : sudah mulai atau belum
        public const string PropIsPrivate = "Private";     // bool    : room butuh kode join
        public const string PropState = "State";           // byte    : GameState saat ini
        public const string PropStateRemain = "Remain";      // float   : detik tersisa untuk state saat ini (late joiner sinkron)
        public const string PropRound = "Round";           // int     : nomor ronde
        public const string PropWinner = "Winner";         // byte    : WinnerType (0 none, 1 hiders, 2 seeker)
        public const string PropWinnerActor = "WinnerId";  // int     : actorNumber Hider terakhir yang hidup

        // ------------------------------------------------------------------
        // KEYPATH PLAYER CUSTOM PROPERTIES
        // ------------------------------------------------------------------
        public const string PropRole = "role";             // byte : GameRole
        public const string PropHp = "hp";                 // int  : HP hider saat ini
        public const string PropAlive = "alive";           // bool : masih hidup?
        public const string PropCatches = "catches";       // int  : jumlah Fang tangkapan (seeker)
        public const string PropSurviveMs = "survMs";      // int  : lama bertahan (ms) untuk leaderboard hider

        // ------------------------------------------------------------------
        // CUSTOM EVENT CODES (RaiseEvent) - 1..199 dipakai internal Photon, jadi mulai dari 200.
        // FREKUENSI TINGGI  -> UNRELIABLE  (kehilangan 1 paket tidak fatal)
        // EVENT KRITIS/GAME -> RELIABLE
        // ------------------------------------------------------------------
        public const byte EvtStateTick = 200;     // [UNRELIABLE 4Hz]   Host -> All: {byte state, float remain}
        public const byte EvtSkillUsed = 201;     // [UNRELIABLE]       {int actor, byte slot, byte skillId, float untilTime}
        public const byte EvtPropSwap = 202;      // [RELIABLE]         {int actor, byte propId, float untilTime}
        public const byte EvtPropEnd = 203;       // [RELIABLE]         {int actor}  (reserved: PropSwap berhenti via PunRPC berdurasi)
        public const byte EvtSonicBlast = 204;    // [RELIABLE]         {int actor, float x, float y}
        public const byte EvtRadar = 205;         // [MASTER CLIENT]    {float x, float y, float dur} (log/telemetri host)
        public const byte EvtGhost = 206;         // [RELIABLE]         {int actor}
        public const byte EvtToast = 207;         // [RELIABLE]         {string msg}
        public const byte EvtAssignRole = 208;    // [RELIABLE]         {int actor, byte role} (Host -> tiap klien set prop dirinya)
        public const byte EvtSlow = 209;          // [UNRELIABLE]       {int actor, float factor, float dur} (kena Sonic Blast)
        public const byte EvtStateChange = 210;   // [RELIABLE]         {byte state, float duration, int round} (fallback bila PunRPC tak tersedia)
        public const byte EvtFreeze = 211;        // [RELIABLE]         {int actor, float x, float y, r, f, d} - Freeze (skill #3 Hider)
        public const byte EvtRewardRevive = 213;  // [MASTER CLIENT]    {int actor} minta bangkit (rewarded ad) - HANYA Host yang mengabulkan

        // ------------------------------------------------------------------
        // GAMEPLAY BALANCING
        // ------------------------------------------------------------------
        /// <summary>Kapasitas room. 6-12 = 5-11 Hider + 1 Seeker (sesuai spesifikasi).</summary>
        public const int RoomMinPlayers = 2;      // minimal agar bisa playtest / mulai
        public const int RoomMaxPlayers = 12;     // maksimal per room (Photon Cloud free: 20 CCU)
        public const int RoomHardCap = 20;        // batas keras Photon (jangan dilewati)

        public const int CountdownSeconds = 5;
        public const int HidePhaseSeconds = 30;
        public const int SeekPhaseSeconds = 60;
        public const int ResultSeconds = 10;

        /// <summary>HP Hider. Kalau habis -> jadi hantu (spectator) dan tidak bisa menang.</summary>
        public const int HiderMaxHp = 3;

        /// <summary>Hider bergerak 6.0 unit/detik; Seeker +15% (spesifikasi).</summary>
        public const float HiderMoveSpeed = 6.0f;
        public const float SeekerSpeedMultiplier = 1.15f;

        public const float HiderSkillCooldown = 10.0f;
        public const float SeekerSkillCooldown = 8.0f;

        /// <summary>Prop Swap: bertahan maksimal PropSwapDuration, dibatalkan jika ada input gerak.</summary>
        public const float PropSwapDuration = 8.0f;

        /// <summary>Sonic Blast: radius 5 unit, slow 50% selama 2 detik.</summary>
        public const float SonicBlastRadius = 5.0f;
        public const float SonicSlowFactor = 0.5f;
        public const float SonicSlowDuration = 2.0f;

        /// <summary>
        /// FREEZE (skill #3 Hider, parity web CFG.freeze*): pulsa area yang memperlambat semua
        /// Seeker di dalam radius selama FreezeDuration, dan memaku pemakainya sebentar supaya
        /// tidak gratis kabur. Cooldown sendiri (FreezeCooldown) agar tidak merebut slot
        /// Kamuflase/Prop yang memakai HiderSkillCooldown.
        /// </summary>
        public const float FreezeRadius = 4.0f;
        public const float FreezeDuration = 2.5f;
        public const float FreezeSlowFactor = 0.35f;
        public const float FreezeCooldown = 14.0f;
        public const float FreezeSelfRoot = 0.8f;

        /// <summary>Prop Swap ber-arah: radius kandidat saat mode "tahan -> seret -> lepas".</summary>
        public const float PropAimPickRadius = 2.5f;

        /// <summary>
        /// Kamera: 1.0 = seluruh peta terlihat; zoomIdle lebih dekat (diam), zoomRun/zoomSeek
        /// melebar. Dipakai Utils/PlayerCamera.cs dan web/uiKit.js Camera2D (satu sumber angka).
        /// </summary>
        public const float CamIdleZoom = 1.25f;
        public const float CamRunZoom = 1.08f;
        public const float CamSeekZoom = 1.0f;
        public const float CamRunSpeed = 4.8f;
        public const float CamSmoothTime = 0.12f;

        /// <summary>Pushback saat Hider dipukul Seeker: 3 meter.</summary>
        public const float PushbackDistance = 3.0f;
        public const float PushbackDuration = 0.35f;
        public const float HitInvulnerable = 0.6f;      // grace period supaya tidak "one-click-kill"
        public const float CatchMaxRange = 3.0f;        // jangkauan tap/klik Seeker
        public const float CatchMinInterval = 0.25f;    // anti spam tap

        /// <summary>Alpha sprite saat hider sudah mati (mode hantu).</summary>
        public const float GhostAlpha = 0.3f;

        // ------------------------------------------------------------------
        // LAYER (lihat README untuk cara assign). Layer 6 = Ground untuk Raycast camo.
        // ------------------------------------------------------------------
        public const int GroundLayerIndex = 6;

        // ---- Monetisasi: penawaran rewarded ad (lihat Monetization/RewardOffers.cs) ----
        /// <summary>HP yang diberikan saat bangkit dari mode hantu.</summary>
        public const int ReviveHp = 1;
        /// <summary>Batas revive per ronde per pemain (anti spam iklan).</summary>
        public const int MaxRevivesPerRound = 1;
        /// <summary>Batas "skip cooldown" per ronde per pemain.</summary>
        public const int MaxCooldownSkipsPerRound = 2;
        /// <summary>Batas "Frenzy" Seeker per ronde.</summary>
        public const int MaxFrenziesPerRound = 2;
        /// <summary>Jendela kebal setelah bangkit (detik) supaya tidak langsung ditangkap lagi.</summary>
        public const float ReviveSafeWindow = 1.6f;
        /// <summary>Durasi boost Frenzy (detik).</summary>
        public const float FrenzyDuration = 10f;
        /// <summary>Pengali kecepatan saat Frenzy.</summary>
        public const float FrenzySpeedMultiplier = 1.25f;
        /// <summary>Tambahan jangkauan tangkap (meter) saat Frenzy.</summary>
        public const float FrenzyCatchRangeBonus = 1.5f;
        /// <summary>Jeda minimum antar tayang iklan (SDK menolak show yang terlalu rapat).</summary>
        public const float AdMinGapSeconds = 12f;

        /// <summary>Helper kecil untuk membaca custom property dengan aman.</summary>
        public static T GetProp<T>(ExitGames.Client.Photon.Hashtable table, string key, T fallback = default(T))
        {
            if (table == null || !table.ContainsKey(key)) return fallback;
            object o = table[key];
            if (o is T) return (T)o;
            if (o != null && typeof(T).IsEnum) return (T)System.Enum.Parse(typeof(T), o.ToString());
            try { return (T)System.Convert.ChangeType(o, typeof(T)); }
            catch { return fallback; }
        }
    }

    /// <summary>
    /// Wrapper RaiseEvent: memakai RaiseEventOptions + SendOptions agar hemat bandwidth
    /// (event frekuensi tinggi dikirim UNRELIABLE, event penting dikirim RELIABLE).
    /// </summary>
    public static class Net
    {
        /// <summary>Raise event ke semua orang di room (termasuk diri sendiri).</summary>
        public static void RaiseAll(byte eventCode, object content, bool reliable)
        {
            if (!PhotonNetwork.InRoom) return;
            var opt = new RaiseEventOptions { Receivers = ReceiverGroup.All };
            PhotonNetwork.RaiseEvent(eventCode, content, opt, new SendOptions { Reliability = reliable });
        }

        /// <summary>Raise event ke pemain lain saja (hemat 1 round-trip untuk si pengirim).</summary>
        public static void RaiseOthers(byte eventCode, object content, bool reliable)
        {
            if (!PhotonNetwork.InRoom) return;
            var opt = new RaiseEventOptions { Receivers = ReceiverGroup.Others };
            PhotonNetwork.RaiseEvent(eventCode, content, opt, new SendOptions { Reliability = reliable });
        }

        /// <summary>Kirim event khusus ke Host (Authority). Contoh: lencana Radar ke host.</summary>
        public static void RaiseMaster(byte eventCode, object content, bool reliable)
        {
            if (!PhotonNetwork.InRoom) return;
            var opt = new RaiseEventOptions { Receivers = ReceiverGroup.MasterClient };
            PhotonNetwork.RaiseEvent(eventCode, content, opt, new SendOptions { Reliability = reliable });
        }

        /// <summary>
        /// Broadcast cooldown skill lewat event (BUKAN RPC) supaya tidak membanjiri dispatch
        /// refleksi PunRPC saat tombol spam. Payload = actor + slot + SISA DURASI (detik),
        /// bukan timestamp absolut: tiap klien menghitung cooldownUntil-nya sendiri memakai
        /// clock lokal (Time.time) sehingga aman terhadap beda waktu antar perangkat.
        /// </summary>
        public static void SyncCooldown(int actorNumber, byte slot, float remainingSeconds)
        {
            var content = new ExitGames.Client.Photon.Hashtable
            {
                { "a", actorNumber },
                { "s", slot },
                { "d", remainingSeconds }
            };
            RaiseAll(HideSeekConstants.EvtSkillUsed, content, false);
        }

        /// <summary>Clamp magnitude vektor (hemat sqrt bila sudah pasti di dalam range).</summary>
        public static Vector2 ClampMagnitude(Vector2 v, float max)
        {
            float sqr = v.sqrMagnitude;
            if (sqr > max * max) return v * (max / Mathf.Sqrt(sqr));
            return v;
        }

        /// <summary>Format 41.5 -> "0:41" untuk UI timer.</summary>
        public static string FormatTime(float seconds)
        {
            if (seconds < 0f) seconds = 0f;
            int t = Mathf.CeilToInt(seconds);
            return string.Format("{0:00}:{1:00}", t / 60, t % 60);
        }
    }
}
