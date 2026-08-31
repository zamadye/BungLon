// ============================================================================
//  PlayerController.cs   (SCRIPT #3 - wajib)
//  - Input (joystick virtual / WASD), movement 2D top-down, flip, animator.
//  - Sinkronisasi posisi via OnPhotonSerializeView (stream PUN2) + interpolasi
//    & ekstrapolasi di sisi penerima agar remote player terlihat halus.
//  - Tap/klik Seeker untuk menangkap (diarahkan ke PlayerCombat.RequestHit).
//  - Hook untuk state game: movement terkunci saat COUNTDOWN/RESULT, ghost terkunci.
//
//  CATATAN SETUP: prefab pemain wajib punya PhotonView dan komponen ini harus
//  ada di daftar "Observed Components" (lihat README).
// ============================================================================
using System.Collections;
using ExitGames.Client.Photon;
using HideSeek.Core;
using HideSeek.Game;
using HideSeek.Network;
using HideSeek.Skills;
using HideSeek.Utils;
using Photon.Pun;
using Photon.Realtime;
using UnityEngine;
using HideSeek.UI;

namespace HideSeek.Players
{
    [RequireComponent(typeof(PhotonView))]
    // Komponen wajib ikut ditambahkan otomatis saat script ini di-drag ke GameObject
    // (menghindari error paling umum: PhotonView / Rigidbody2D / PlayerVisual ketinggalan).
    [RequireComponent(typeof(PhotonView))]
    [RequireComponent(typeof(Rigidbody2D))]
    [RequireComponent(typeof(PlayerVisual))]
    public class PlayerController : MonoBehaviourPunCallbacks, IPunObservable, IOnEventCallback, IPunInstantiateMagicCallback
    {
        // =========================== REQUIRED PARTS =============================
        private PhotonView pv;   // diisi otomatis di Awake (hindari shadow PhotonView bawaan MonoBehaviourPun)
        public PhotonView View { get { return pv; } }

        [Header("References (assign manual di Inspector)")]
        [Tooltip("Rigidbody2D karakter. Disarankan Dynamic, gravityScale = 0, collision mode Continuous.")]
        public Rigidbody2D body;

        [Tooltip("Node visual yang di-flip (bukan transform fisik, agar tidak mengganggu jangkauan tangkap).")]
        public PlayerVisual visual;

        [Tooltip("Opsional: Animator 2D (parameter float 'Speed', bool 'IsMoving').")]
        public Animator animator;

        [Tooltip("Joystick virtual (UI). Bila null, hanya keyboard yang bekerja.")]
        public MobileJoystick joystick;

        [Tooltip("Layer masker untuk tap-to-catch (hanya hider).")]
        public LayerMask hiderLayerMask = ~0;

        // ============================== TUNING =================================
        [Header("Movement")]
        [Tooltip("Kecepatan dasar (unit/detik). Seeker otomatis x1.15 (spesifikasi).")]
        public float baseMoveSpeed = HideSeekConstants.HiderMoveSpeed;

        [Tooltip("Kecepatan smoothing interpolasi posisi remote (lebih besar = lebih ketat).")]
        public float interpolationSpeed = 14.0f;

        [Tooltip("Faktor ekstrapolasi memakai velocity yang dikirim (0 = hanya lerp).")]
        [Range(0f, 1f)] public float extrapolation = 0.6f;

        [Tooltip("Threshold input joystick yang dianggap 'bergerak' (pembatal Prop Swap).")]
        public float moveInputDeadZone = 0.12f;

        // =============================== STATE =================================
        /// <summary>Role lokal/remote untuk objek ini (diisi Host lewat GameManager).</summary>
        public GameRole Role { get; private set; }

        /// <summary>Posisi terakhir yang diterima dari jaringan (untuk remote smoothing).</summary>
        public Vector2 NetPosition { get; private set; }

        /// <summary>Velocity terkirim (dipakai receiver untuk ekstrapolasi).</summary>
        public Vector2 NetVelocity { get; private set; }

        /// <summary>Input gerak yang sudah di-normalisasi & clamp (0..1). Dipakai HiderSkill (batal prop).</summary>
        public Vector2 MoveInput { get; private set; }

        /// <summary>True bila objek ini dimengerti oleh kita (local player).</summary>
        public bool IsLocal { get { return pv != null && pv.IsOwner; } }

        /// <summary>True bila view ini benar-benar owned oleh kita (dipakai GameManager utk RPC broadcast).</summary>
        public bool IsOwnerOfView { get { return pv != null && pv.IsOwner; } }

        /// <summary>Mode hantu (hider HP=0) atau penonton (late join) -> tidak bisa gerak, tidak bisa skill.</summary>
        public bool IsGhost { get; private set; }

        /// <summary>Multiplier kecepatan sementara (Sonic Blast = 0.5 selama 2 detik).</summary>
        private float speedMultiplier = 1f;
        private Coroutine slowRoutine;

        /// <summary>PlayerCombat milik objek ini (diisi otomatis di Awake).</summary>
        public PlayerCombat Combat { get; private set; }

        /// <summary>HiderSkill / SeekerSkill milik objek ini (opsional, tergantung role).</summary>
        public HiderSkill HiderSkills { get; private set; }
        public SeekerSkill SeekerSkills { get; private set; }

        // Velocitas yang kita kirim ke jaringan (agar receiver bisa ekstrapolasi).
        private Vector2 netSendVelocity;
        private bool netFlip;

        [SerializeField] private float boostMultiplier = 1f;   // boost sementara dari hadiah iklan
        private Coroutine boostRoutine;
        private RoleSkin roleSkin;

        // Data yang diterima dari owner (remote smoothing).
        private Vector2 targetPos;
        private Vector2 targetVel;
        private bool hasNetworkData;

        // ============================== LIFECYCLE ===============================
        private void Awake()
        {
            pv = GetComponent<PhotonView>();
            if (body == null) body = GetComponent<Rigidbody2D>();
            if (visual == null) visual = GetComponent<PlayerVisual>();
            Combat = GetComponent<PlayerCombat>();
            HiderSkills = GetComponent<HiderSkill>();
            SeekerSkills = GetComponent<SeekerSkill>();

            if (pv == null)
                Debug.LogError("[HideSeek] PlayerController butuh PhotonView pada prefab pemain!", this);

            roleSkin = GetComponent<RoleSkin>();   // opsional: ganti sprite saat role berubah

            // Jaring pengaman: banyak yang lupa menyetel Rigidbody2D -> dipaksa gravity 0 + freeze Z.
            if (body != null)
            {
                body.gravityScale = 0f;
                body.freezeRotation = true;
                if (body.bodyType == RigidbodyType2D.Dynamic) body.collisionDetectionMode = CollisionDetectionMode2D.Continuous;
            }

            if (visual != null) visual.Capture();
            NetPosition = targetPos = transform.position;

            // Joystick otomatis diambil dari UIManager bila tidak di-assign.
            if (joystick == null && UIManager.Instance != null) joystick = UIManager.Instance.Joystick;
        }

        /// <summary>ActorNumber pemilik objek ini (diisi saat registrasi). Dipakai untuk Unregister.</summary>
        private int registeredActor;

        // MonoBehaviourPunCallbacks mendaftarkan objek ini sebagai callback target di OnEnable/OnDisable.
        // WAJIB override + panggil base supaya OnEvent (slow Sonic Blast) & callbacks lain tetap diterima.
        public override void OnEnable()
        {
            base.OnEnable();
            NetPosition = targetPos = transform.position;
            EnsureRegistered();
        }

        public override void OnDisable()
        {
            base.OnDisable();
            if (registeredActor > 0) PlayerRegistry.Unregister(registeredActor, this);
            registeredActor = 0;
        }

        private void Start()
        {
            // PUN2 kadang mengisi PhotonView.Owner setelah OnEnable (instantiate via network) -> coba lagi.
            EnsureRegistered();
            if (GameManager.Instance != null) SetRole(GameManager.Instance.GetRole(registeredActor));
            if (roleSkin != null) roleSkin.Apply(Role);   // pasang skin walau role belum berubah
        }

        /// <summary>Hook khusus PUN2: dipanggil tepat setelah objek di-instantiate lewat network.</summary>
        private void OnPhotonInstantiate(PhotonMessageInfo info)
        {
            EnsureRegistered();
            if (info != null && info.Sender != null) InitFromSpawn(info.Sender);
        }

        /// <summary>Daftarkan diri ke PlayerRegistry (idempotent).</summary>
        private void EnsureRegistered()
        {
            if (pv == null || pv.Owner == null) return;
            registeredActor = pv.Owner.ActorNumber;
            PlayerRegistry.Register(registeredActor, this);
        }

        /// <summary>Dipanggil NetworkManager sehabis instantiate (inisialisasi nick/label nama).</summary>
        public void InitFromSpawn(Player owner)
        {
            if (owner == null) return;
            if (Role == GameRole.None)
                Role = GameManager.Instance != null ? GameManager.Instance.GetRole(owner.ActorNumber) : GameRole.None;
            ApplyRoleVisual();
        }

        // ================================ UPDATE ================================

        private void Update()
        {
            if (pv == null) return;

            if (IsLocal) UpdateLocal();
            else UpdateRemote();
        }

        /// <summary>
        /// LOCAL: baca input -> gerakkan -> catat velocity untuk dikirim.
        /// Movement hanya boleh saat HIDE/SEEK, bukan ghost, bukan countdown/result.
        /// </summary>
        private void UpdateLocal()
        {
            GameManager gm = GameManager.Instance;
            bool stunned = Combat != null && Combat.IsPushing;      // sedang terlempar -> input dikunci
            // Seeker dikunci selama HIDE PHASE (hider bebas bergerak) - lihat GameManager.CanMove.
            bool canMove = !IsGhost && !stunned && !frozenForProp && (gm == null || gm.CanMove(gm.State, Role));

            MoveInput = canMove ? ReadMoveInput() : Vector2.zero;

            if (body != null)
            {
                Vector2 vel = MoveInput * CurrentMoveSpeed;      // unit/detik (dikirim ke jaringan)
                netSendVelocity = vel;

                // BodyType Kinematic TIDAK membaca velocity -> wajib MovePosition (ceklist manual
                // memakai Kinematic; prefab hasil Setup Tool memakai Dynamic). Dua-duanya didukung.
                bool kinematic = body.bodyType != RigidbodyType2D.Dynamic;
                if (kinematic)
                    body.MovePosition(body.position + vel * Time.deltaTime);
                else
                    body.velocity = vel;
            }
            else
            {
                // Tidak ada Rigidbody2D (mis. debug) -> gerakkan transform langsung.
                Vector2 vel = MoveInput * CurrentMoveSpeed * Time.deltaTime;
                transform.position += (Vector3)vel;
                netSendVelocity = MoveInput * CurrentMoveSpeed;
            }

            // hadap kiri/kanan (visual saja)
            if (Mathf.Abs(MoveInput.x) > 0.01f && visual != null)
            {
                bool flip = MoveInput.x < 0f;
                if (flip != netFlip) { netFlip = flip; visual.SetFlip(flip); }
            }

            UpdateAnimator(Mathf.Abs(netSendVelocity.x) + Mathf.Abs(netSendVelocity.y));

            // --- TAP untuk menangkap (khusus Seeker, hanya saat SEEK_PHASE) ---
            if (Role == GameRole.Seeker && !IsGhost && (gm == null || gm.State == GameState.SeekPhase))
                TryCatchTap();
        }

        /// <summary>
        /// REMOTE: interpolasi (lerp) ke posisi terkirim + ekstrapolasi kecil
        /// memakai velocity supaya tidak terlihat "patah-patah" di 4G.
        /// </summary>
        private void UpdateRemote()
        {
            if (!hasNetworkData) return;

            Vector3 desired = targetPos + targetVel * (Time.deltaTime * extrapolation);
            float t = 1f - Mathf.Exp(-interpolationSpeed * Time.deltaTime);
            transform.position = Vector3.Lerp(transform.position, desired, t);

            // Flip remote diambil dari data stream (lihat OnPhotonSerializeView).
            if (visual != null) visual.SetFlip(netFlip);
        }

        /// <summary>
        /// Kecepatan final: dasar * multiplier role * multiplier efek (slow) * boost (rewarded ad).
        /// </summary>
        public float CurrentMoveSpeed
        {
            get
            {
                float s = baseMoveSpeed;
                if (Role == GameRole.Seeker) s *= HideSeekConstants.SeekerSpeedMultiplier;  // +15%
                return s * speedMultiplier * boostMultiplier;
            }
        }

        /// <summary>Tambahan jangkauan tangkap (meter) dari boost Frenzy (lihat RewardOffers).</summary>
        public float CatchRangeBonus { get; private set; }

        /// <summary>
        /// Boost sementara (hadiah iklan): factor > 1 mempercepat, catchRangeBonus memperlebar
        /// jangkauan tangkap. Dipasang di korban sendiri, jadi aman tanpa konfirmasi Host
        /// (posisi pemain memang diotoritas oleh pemiliknya di PUN).
        /// </summary>
        public void ApplySpeedBoost(float factor, float duration, float catchRangeBonus = 0f)
        {
            if (IsGhost) return;
            boostMultiplier = Mathf.Max(1f, factor);
            CatchRangeBonus = Mathf.Max(0f, catchRangeBonus);
            if (boostRoutine != null) StopCoroutine(boostRoutine);
            boostRoutine = StartCoroutine(CoroutineBoostRestore(duration));
        }

        private IEnumerator CoroutineBoostRestore(float duration)
        {
            yield return new WaitForSeconds(Mathf.Max(0.1f, duration));
            boostMultiplier = 1f;
            CatchRangeBonus = 0f;
            boostRoutine = null;
        }

        /// <summary>WASD/Arrow + joystick virtual. Magnitude di-clamp ke 1 (agar diagonal tidak 1.41x cepat).</summary>
        private Vector2 ReadMoveInput()
        {
            float h = Input.GetAxisRaw("Horizontal");
            float v = Input.GetAxisRaw("Vertical");
            Vector2 kb = new Vector2(h, v);

            if (joystick != null && joystick.Active)
                kb = new Vector2(joystick.Direction.x, joystick.Direction.y);

            if (kb.sqrMagnitude > 1f) kb = kb.normalized;
            if (kb.sqrMagnitude < moveInputDeadZone * moveInputDeadZone) return Vector2.zero;
            return kb;
        }

        /// <summary>Set parameter animator; aman bila animator kosong.</summary>
        private static readonly int SpeedHash = Animator.StringToHash("Speed");
        private static readonly int MovingHash = Animator.StringToHash("IsMoving");

        private void UpdateAnimator(float speed01)
        {
            if (animator == null) return;
            animator.SetFloat(SpeedHash, speed01);
            animator.SetBool(MovingHash, speed01 > 0.05f);
        }

        // ========================= NETWORK SYNC (WAJIB) =========================

        /// <summary>
        /// SINKRONISASI POSISI & "ROTASI" (flip) lewat stream PUN2.
        /// Owner mengirim; non-owner menerima. Payload kecil: 2 x float2 + 1 velocity + 1 bool.
        /// </summary>
        public void OnPhotonSerializeView(PhotonStream stream, PhotonMessageInfo info)
        {
            if (stream.IsWriting)
            {
                stream.SendNext(transform.position.x);
                stream.SendNext(transform.position.y);
                stream.SendNext(netSendVelocity.x);
                stream.SendNext(netSendVelocity.y);
                stream.SendNext(netFlip);
                stream.SendNext((byte)Role);
            }
            else
            {
                targetPos = new Vector2(ReadF(stream), ReadF(stream));
                targetVel = new Vector2(ReadF(stream), ReadF(stream));
                netFlip = (bool)stream.ReceiveNext();
                Role = (GameRole)stream.ReceiveNext();
                hasNetworkData = true;
                NetPosition = targetPos;
                NetVelocity = targetVel;

                // Player yang belum kebagian role (mis. setelah host assign) -> segarkan visual.
                if (Combat != null) Combat.OnRemoteSync();
            }
        }

        private static float ReadF(PhotonStream s)
        {
            object o = s.ReceiveNext();
            if (o is float) return (float)o;
            if (o is double) return (float)(double)o;
            if (o is int) return (int)o;
            return 0f;
        }

        // ============================ TAP-TO-CATCH ==============================

        /// <summary>Terakhir kali kita mencoba menangkap (anti spam tap).</summary>
        private float lastTapAttempt;

        /// <summary>
        /// Seeker menekan layar / klik kiri pada Hider.
        /// Urutan: raycast 2D dari kamera -> cari PlayerController hider -> cek jarak <= 3 unit
        /// -> minta PlayerCombat mengirim request hit.
        /// </summary>
        private void TryCatchTap()
        {
            bool pressed = Input.GetMouseButtonDown(0);
#if UNITY_ANDROID || UNITY_IOS
            if (!pressed && Input.touchCount > 0)
                pressed = Input.GetTouch(0).phase == TouchPhase.Began;
#endif
            if (!pressed) return;
            if (Time.unscaledTime - lastTapAttempt < HideSeekConstants.CatchMinInterval) return;
            if (UnityEngine.EventSystems.EventSystem.current != null &&
                UnityEngine.EventSystems.EventSystem.current.IsPointerOverGameObject(-1)) return;

            lastTapAttempt = Time.unscaledTime;
            Vector2 worldPoint = Camera.main != null
                ? Camera.main.ScreenToWorldPoint(Input.mousePosition)
                : (Vector2)transform.position;

            Collider2D under = Physics2D.OverlapPoint(worldPoint, hiderLayerMask, QueryTriggerInteraction.Collide);
            PlayerController target = null;
            if (under != null)
            {
                target = under.GetComponentInParent<PlayerController>();
                if (target == null)
                {
                    var hitView = under.GetComponentInParent<PhotonView>();
                    if (hitView != null) target = PlayerRegistry.Get(hitView.Owner != null ? hitView.Owner.ActorNumber : -1);
                }
            }

            // Bila tap "meleset" sedikit dari sprite, ambil hider terdekat dalam jangkauan (mobile-friendly).
            if (target == null)
                target = PlayerRegistry.FindNearestLivingHider(transform.position,
                        HideSeekConstants.CatchMaxRange * HideSeekConstants.CatchMaxRange);

            if (target == null || target.Combat == null) return;
            if (target.Role != GameRole.Hider) return;

            float dist = Vector2.Distance(transform.position, target.NetPosition);
            if (dist > HideSeekConstants.CatchMaxRange)
            {
                if (UIManager.Instance != null) UIManager.Instance.ShowToast("Terlalu jauh!");
                return;
            }
            Combat.RequestHitOn(target);
        }

        // ========================= ROLE / STATE CONTROL =========================

        /// <summary>Diisi oleh GameManager (via event EvtAssignRole) atau dari stream remote.</summary>
        public void SetRole(GameRole role)
        {
            if (Role == role) return;
            Role = role;
            ApplyRoleVisual();
            if (roleSkin != null) roleSkin.Apply(role);   // sprite Hider/Seeker (opsional, lihat Setup > 5)
            // Catatan: komponen skill TIDAK di-disable (PUN2 event callback butuh komponen aktif);
            // penguncian dilakukan di dalam TryUseSkill() lewat pengecekan Role + state.
            if (HiderSkills != null) HiderSkills.OnRoleChanged(role);
            if (SeekerSkills != null) SeekerSkills.OnRoleChanged(role);
        }

        /// <summary>Warna dasar per role (biar di playtest cepat terlihat mana Seeker).</summary>
        private void ApplyRoleVisual()
        {
            if (visual == null || IsGhost) return;
            // Bila prefab memakai RoleSkin (sprite khusus per role), jangan ditint ulang:
            // skin sudah membedakan Hider (hijau) vs Seeker (biru).
            if (roleSkin != null && roleSkin.Applied) return;
            Color c = Role == GameRole.Seeker ? new Color(0.85f, 0.25f, 0.25f) : new Color(0.25f, 0.7f, 0.9f);
            visual.TintAll(c);
        }

        /// <summary>Jadi penonton/hantu: tanpa input, tanpa collider fisik, transparan.</summary>
        public void SetSpectator(bool ghost)
        {
            IsGhost = ghost;
            MoveInput = Vector2.zero;
            if (body != null) body.velocity = Vector2.zero;
            if (visual != null)
            {
                visual.SetAlpha(ghost ? HideSeekConstants.GhostAlpha : visual.BaseAlpha);
                visual.SetVisible(true);
            }
            var col = GetComponent<Collider2D>();
            if (col != null) col.enabled = !ghost;
            if (UIManager.Instance != null) UIManager.Instance.SetGhostMode(ghost);
            if (ghost) PlayerRegistry.RefreshLivingHiders();
        }

        /// <summary>Reset penuh untuk ronde baru (dipanggil GameManager saat masuk COUNTDOWN).</summary>
        public void ResetForRound()
        {
            SetSpectator(false);
            frozenForProp = false;
            speedMultiplier = 1f;
            if (slowRoutine != null) { StopCoroutine(slowRoutine); slowRoutine = null; }
            boostMultiplier = 1f;
            CatchRangeBonus = 0f;
            if (boostRoutine != null) { StopCoroutine(boostRoutine); boostRoutine = null; }

            hasNetworkData = false;
            netSendVelocity = Vector2.zero;
            MoveInput = Vector2.zero;
            NetPosition = transform.position;
            if (body != null) body.velocity = Vector2.zero;

            if (Combat != null) Combat.ResetForRound();
            if (HiderSkills != null) HiderSkills.ResetForRound();
            if (SeekerSkills != null) SeekerSkills.ResetForRound();

            Vector3 spawn = NetworkManager.Instance != null && pv != null && pv.Owner != null
                ? NetworkManager.Instance.GetSpawnPosition(pv.Owner.ActorNumber, PhotonNetwork.CurrentRoom != null ? PhotonNetwork.CurrentRoom.PlayerCount : 1)
                : transform.position;
            transform.position = spawn;
            NetPosition = targetPos = spawn;

            ApplyRoleVisual();
        }

        // ============================== FREEZE / PROPS ==========================

        /// <summary>
        /// Dikunci oleh skill Prop Swap (HiderSkill): input & velocity dinolkan,
        /// TAPI stream posisi tetap jalan supaya Seeker melihat prop ikut bergeser saat pushback.
        /// </summary>
        public void FreezeForProp(bool freeze)
        {
            frozenForProp = freeze;
            if (freeze)
            {
                MoveInput = Vector2.zero;
                if (pv != null && body != null) body.velocity = Vector2.zero;
            }
        }

        /// <summary>True saat jadi prop (input dikunci).</summary>
        public bool IsFrozenForProp { get { return frozenForProp; } }
        private bool frozenForProp;

        // ============================== SPEED FX ===============================

        /// <summary>
        /// Dipakai SeekerSkill (Sonic Blast) untuk memberi slow 50% selama 2 detik.
        /// Dipanggil secara lokal di klien pemilik (lihat PlayerCombat/SeekerSkill event handler).
        /// </summary>
        public void ApplySpeedSlow(float factor, float duration)
        {
            if (IsGhost) return;
            speedMultiplier = Mathf.Min(speedMultiplier, Mathf.Clamp(factor, 0.05f, 1f));
            if (slowRoutine != null) StopCoroutine(slowRoutine);
            slowRoutine = StartCoroutine(CoroutineSpeedRestore(duration));
        }

        private IEnumerator CoroutineSpeedRestore(float duration)
        {
            yield return new WaitForSeconds(duration);
            speedMultiplier = 1f;
            slowRoutine = null;
        }

        // ================== RPC KHUSUS: BROADCAST DARI HOST ====================

        /// <summary>
        /// Dipanggil HANYA oleh Host (view ini owned oleh host) untuk menyebarkan transisi state
        /// ke seluruh room lewat PunRPC. GameManager.ApplyState idempoten, jadi bila paket
        /// datang 2x (RPC + event fallback) tidak ada efek ganda.
        /// </summary>
        public void SendHostStateRpc(byte state, float duration, int round, byte winner, int winnerActor)
        {
            if (pv == null || !pv.IsOwner) return;
            pv.RPC(nameof(RpcHostState), RpcTarget.All, state, duration, round, winner, winnerActor);
        }

        /// <summary>[PunRPC] semua klien: terapkan state game.</summary>
        [PunRPC]
        private void RpcHostState(byte state, float duration, int round, byte winner, int winnerActor)
        {
            if (GameManager.Instance != null)
                GameManager.Instance.ApplyState(state, duration, round, winner, winnerActor);
        }

        // ========================= EVENT: EFEK KECEPATAN =======================

        /// <summary>
        /// Terima event dari skill Seeker (Sonic Blast -> slow 50% / 2 detik).
        /// Hanya klien yang menjadi korban yang menerapkan efeknya, jadi tidak ada
        /// duplikasi state antar klien.
        /// </summary>
        // EventData dikirim oleh PhotonNetwork.RaiseEvent (lihat HideSeekConstants.Net).
        public void OnEvent(EventData photonEvent)
        {
            if (photonEvent.Code != HideSeekConstants.EvtSlow) return;
            var p = photonEvent.CustomData as Hashtable;
            if (p == null) return;

            int actor = HideSeekConstants.GetProp(p, "a", 0);
            if (pv == null || pv.Owner == null || pv.Owner.ActorNumber != actor) return;
            if (Role != GameRole.Hider) return;      // Seeker tidak bisa di-slow

            float factor = HideSeekConstants.GetProp(p, "f", HideSeekConstants.SonicSlowFactor);
            float dur = HideSeekConstants.GetProp(p, "d", HideSeekConstants.SonicSlowDuration);

            ApplySpeedSlow(factor, dur);
            if (Time.frameCount != lastFlashFrame) { lastFlashFrame = Time.frameCount; StartCoroutine(CoroutineSlowFlash()); }
        }

        private int lastFlashFrame = -1;

        /// <summary>Kedip ungu singkat sebagai umpan balik "kena Sonic Blast".</summary>
        private IEnumerator CoroutineSlowFlash()
        {
            if (visual == null) yield break;
            Color c = visual.renderers != null && visual.renderers.Count > 0 && visual.renderers[0] != null
                ? visual.renderers[0].color : Color.white;
            visual.TintAll(Color.Lerp(c, new Color(0.6f, 0.3f, 1f), 0.5f));
            yield return new WaitForSeconds(0.3f);
            visual.TintAll(c);
        }

        // ================================ DEBUG ================================

        /// <summary>Draw gizmo jangkauan tangkap Seeker supaya mudah di-tuning.</summary>
        private void OnDrawGizmosSelected()
        {
            Gizmos.color = Color.red;
            Gizmos.DrawWireSphere(transform.position, HideSeekConstants.CatchMaxRange);
            Gizmos.color = Color.green;
            Gizmos.DrawLine(transform.position, transform.position + (Vector3)MoveInput * 2f);
        }
    }
}
