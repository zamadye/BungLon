// ============================================================================
//  PlayerCombat.cs   (SCRIPT #4 - wajib)
//  - Hider: 3 HP, damage dari Seeker (tap/klik ATAU sentuhan), pushback 3 meter,
//    HP habis -> jadi hantu (transparan, tidak bisa bergerak).
//  - Seeker: menangkap Hider (validasi jarak <= 3 unit + interval anti-spam) dan
//    menambah stat "catches" ke custom property miliknya.
//  - Sumber kebenaran HP = KLIEN PEMILIK hider (owner-authoritative). Seeker hanya
//    mengirim "permintaan" lewat [PunRPC] pada view-nya sendiri (legal karena owner),
//    lalu owner memvalidasi & broadcast hasil lewat [PunRPC] pada view hider.
//
//  Catatan: ini model client-authoritative khas Photon Cloud (tanpa Photon Server).
//  Bila butuh anti-cheat lebih ketat, pindahkan validasi ke Webhook/Server.
// ============================================================================
using System;
using System.Collections;
using ExitGames.Client.Photon;
using HideSeek.Core;
using HideSeek.Game;
using HideSeek.Utils;
using Photon.Pun;
using Photon.Realtime;
using UnityEngine;

namespace HideSeek.Players
{
    [RequireComponent(typeof(PlayerController))]
    public class PlayerCombat : MonoBehaviourPun
    {
        // ============================ INSPECTOR ================================
        [Header("References (assign manual)")]
        public PlayerController controller;
        public PlayerVisual visual;
        [Tooltip("Collider fisik badan (dimatikan saat jadi hantu).")]
        public Collider2D bodyCollider;

        [Header("HP (Hider)")]
        [Tooltip("Jumlah nyawa Hider. Seeker tidak memakai HP.")]
        public int maxHp = HideSeekConstants.HiderMaxHp;

        [Tooltip("Durasi kebal setelah kena pukulan (mencegah HP habis dalam 1 klik).")]
        public float invulnerableAfterHit = HideSeekConstants.HitInvulnerable;

        [Tooltip("Interval damage otomatis bila Seeker menempel (OnTriggerStay2D).")]
        public float contactDamageInterval = 0.8f;

        [Header("Pushback")]
        [Tooltip("Jarak lontaran saat kena (meter). Spesifikasi: 3 m.")]
        public float pushbackDistance = HideSeekConstants.PushbackDistance;
        public float pushbackDuration = HideSeekConstants.PushbackDuration;

        [Header("Feedback (opsional, boleh kosong)")]
        public ParticleSystem hitVfx;
        public AudioSource hitSfx;
        public AudioClip hitClip;
        public GameObject deathEffect;

        // ============================== EVENTS =================================
        /// <summary>HP berubah (current, max). Dipakai UIManager (hearts/HP bar).</summary>
        public event Action<int, int> OnHpChanged;
        /// <summary>Hider mati (dipanggil di semua klien, hanya yang punya yang memicu logika).</summary>
        public event Action OnDied;
        /// <summary>Seeker menambah tangkapan (catches).</summary>
        public event Action<int> OnCatchCountChanged;

        // =============================== STATE ===================================
        public int Hp { get; private set; }
        public int MaxHp { get { return Mathf.Max(1, maxHp); } }
        public bool IsDead { get; private set; }
        public int Catches { get; private set; }
        public bool IsInvulnerable { get { return Time.time < invulnUntil; } }

        private PhotonView pv;
        private float invulnUntil;
        private float lastContactDamage;
        private Coroutine pushRoutine;

        /// <summary>True saat animasi pushback berjalan (PlayerController mengunci input supaya tidak "lawan arahkan").</summary>
        public bool IsPushing { get; private set; }

        // ============================== LIFECYCLE ================================
        private void Awake()
        {
            pv = GetComponent<PhotonView>();
            if (controller == null) controller = GetComponent<PlayerController>();
            if (visual == null) visual = GetComponent<PlayerVisual>();
            if (bodyCollider == null) bodyCollider = GetComponent<Collider2D>();
            Hp = MaxHp;
        }

        private void Start()
        {
            // Late join: ambil HP/alive dari custom property pemilik (sumber kebenaran kedua).
            if (pv != null && !pv.IsOwner && pv.Owner != null) SyncFromProperties(pv.Owner);
        }

        // ============================ PUBLIC API ================================

        /// <summary>Reset HP/ghost/pushback saat ronde baru (dipanggil PlayerController.ResetForRound).</summary>
        public void ResetForRound()
        {
            if (pushRoutine != null) { StopCoroutine(pushRoutine); pushRoutine = null; }
            IsPushing = false;
            invulnUntil = 0f;
            lastContactDamage = 0f;

            GameRole role = controller != null ? controller.Role : GameRole.None;
            Hp = role == GameRole.Hider ? MaxHp : 0;
            IsDead = false;
            Catches = 0;

            if (visual != null) { visual.ResetToBase(); visual.SetAlpha(1f); }
            if (bodyCollider != null) bodyCollider.enabled = true;
            if (OnHpChanged != null) OnHpChanged(Hp, MaxHp);
        }

        /// <summary>
        /// Seeker ingin menangkap <paramref name="target"/>. Hanya Seeker yang boleh memanggil.
        /// Kirim request lewat PunRPC di view KITA (owner = kita) supaya target-nya owner
        /// yang memvalidasi (jarak & HP) - inilah pola yang aman di PUN2.
        /// </summary>
        public void RequestHitOn(PlayerController target)
        {
            if (pv == null || !pv.IsOwner) return;                    // hanya owner view
            if (target == null || target.Combat == null) return;
            if (target.Combat.IsDead) return;
            if (controller == null || controller.Role != GameRole.Seeker) return;

            Vector2 dir = (Vector2)target.transform.position - (Vector2)transform.position;
            if (dir.sqrMagnitude < 0.0001f) dir = Vector2.right;
            dir.Normalize();

            pv.RPC(nameof(RpcHitRequest), RpcTarget.All, target.View, pv.Owner.ActorNumber, dir);
        }

        /// <summary>
        /// [PunRPC] Semua klien menerima "permintaan pukul". Hanya PEMILIK target yang
        /// memvalidasi lalu mengeksekusi damage (single source of truth).
        /// </summary>
        [PunRPC]
        private void RpcHitRequest(PhotonView targetView, int attackerActor, Vector2 dir)
        {
            if (targetView == null) return;
            var victim = targetView.GetComponent<PlayerCombat>();
            if (victim == null || !victim.pv.IsOwner) return;

            // Validasi jarak memakai posisi lokal kita (owner korban) -> anti "hit dari jauh".
            var attacker = PlayerRegistry.Get(attackerActor);
            if (attacker == null || attacker.Role != GameRole.Seeker) return;

            float dist = Vector2.Distance(attacker.NetPosition, victim.transform.position);
            // Jangkauan tangkap si penangkap bisa sedang di-boost (Frenzy dari rewarded ad).
            float range = HideSeekConstants.CatchMaxRange + (attacker != null ? attacker.CatchRangeBonus : 0f);
            if (dist > range * 1.35f)   // toleransi 35% lateness
            {
                if (victim.verbose) Debug.Log("[HideSeek/Combat] hit ditolak: jarak " + dist.ToString("0.00"));
                return;
            }
            victim.ApplyDamageLocal(attackerActor, dir);
        }

        /// <summary>
        /// Eksekusi damage DI KLIEN PEMILIK hider. Melindungi dari spam & state yang salah,
        /// lalu broadcast hasilnya lewat PunRPC pada view hider (kita owner -> legal).
        /// </summary>
        private void ApplyDamageLocal(int attackerActor, Vector2 dir)
        {
            if (pv == null || !pv.IsOwner) return;
            if (IsDead) return;
            if (IsInvulnerable) return;
            if (controller != null && controller.Role != GameRole.Hider) return;

            GameManager gm = GameManager.Instance;
            if (gm != null && gm.State != GameState.HidePhase && gm.State != GameState.SeekPhase) return;

            int newHp = Mathf.Max(0, Hp - 1);
            invulnUntil = Time.time + Mathf.Max(0f, invulnerableAfterHit);
            bool died = newHp <= 0;

            // Broadcast hasil (semua klien animasi seragam) + tulis custom property.
            pv.RPC(nameof(RpcApplyDamage), RpcTarget.All, attackerActor, dir.x, dir.y, newHp, died);
        }

        /// <summary>[PunRPC] Semua klien: kurangi HP, pushback, efek, dan (bila perlu) jadi hantu.</summary>
        [PunRPC]
        private void RpcApplyDamage(int attackerActor, float dirX, float dirY, int newHp, bool died)
        {
            Hp = Mathf.Max(0, newHp);
            if (OnHpChanged != null) OnHpChanged(Hp, MaxHp);

            // Umpan balik visual
            if (hitVfx != null) hitVfx.Play();

            // HUD v2: angka damage melayang (padanan fx.damage() di web). Aman bila HUD tidak ada.
            if (HideSeek.UI.HudV2DamageText.Available)
                HideSeek.UI.HudV2DamageText.Spawn(new Vector2(transform.position.x, transform.position.y + 0.6f),
                    "-1", HideSeek.UI.HudV2Theme.Seeker);
            if (hitSfx != null && hitClip != null) hitSfx.PlayOneShot(hitClip);

            StartPushback(new Vector2(dirX, dirY).normalized);

            bool iAmVictim = pv != null && pv.IsOwner;
            bool iAmAttacker = PhotonNetwork.LocalPlayer != null && PhotonNetwork.LocalPlayer.ActorNumber == attackerActor;

            if (iAmAttacker) AddCatch();
            if (iAmVictim) WriteStatsToPlayerProperties();     // hp/alive ke custom property (late join + leaderboard)

            if (died)
            {
                // Broadcast status hantu (juga memperbarui leaderboard/hp prop milik korban).
                if (iAmVictim) pv.RPC(nameof(RpcBecomeGhost), RpcTarget.All);
            }
        }

        /// <summary>[PunRPC] Semua klien: hider berubah jadi hantu (mati) - transparan & beku.</summary>
        [PunRPC]
        private void RpcBecomeGhost()
        {
            if (IsDead) return;
            IsDead = true;
            Hp = 0;

            if (controller != null) controller.SetSpectator(true);
            if (visual != null) visual.SetAlpha(HideSeekConstants.GhostAlpha);
            if (bodyCollider != null) bodyCollider.enabled = false;
            if (deathEffect != null)
            {
                var fx = Instantiate(deathEffect, transform.position, Quaternion.identity);
                Destroy(fx, 2.5f);
            }
            if (OnHpChanged != null) OnHpChanged(Hp, MaxHp);
            if (OnDied != null) OnDied();

            // Win condition (diproses oleh Host di dalam GameManager.OnHiderRemoved).
            PlayerRegistry.RefreshLivingHiders();
            if (GameManager.Instance != null) GameManager.Instance.OnHiderRemoved();

            // Tulis statistik milik kita sendiri (owner yang boleh menulis prop player).
            WriteStatsToPlayerProperties();
        }

        /// <summary>
        /// [PunRPC] Dibroadcast oleh HOST setelah pemain nonton rewarded ad: hider bangkit lagi
        /// dengan HP sisa. Dikirim lewat PhotonView milik pemain ini supaya hanya host yang bisa
        /// memutuskan (klien hanya mengajukan lewat event EvtRewardRevive).
        /// </summary>
        [PunRPC]
        private void RpcRevived(int newHp)
        {
            if (!IsDead) return;                       // sudah hidup (mis. ronde sudah ganti) -> abaikan

            IsDead = false;
            Hp = Mathf.Clamp(newHp, 1, MaxHp);
            invulnUntil = Time.time + HideSeekConstants.ReviveSafeWindow;   // jeda aman, jangan langsung ketangkap

            if (controller != null) controller.SetSpectator(false);
            if (visual != null) visual.SetAlpha(visual.BaseAlpha);
            if (bodyCollider != null) bodyCollider.enabled = true;

            if (OnHpChanged != null) OnHpChanged(Hp, MaxHp);

            PlayerRegistry.RefreshLivingHiders();
            if (GameManager.Instance != null) GameManager.Instance.OnHiderRevived();

            // Hanya owner yang boleh menulis properti miliknya sendiri.
            if (pv != null && pv.IsOwner) WriteStatsToPlayerProperties();
        }

        /// <summary>Seeker: +1 catch (ditulis ke custom property agar muncul di leaderboard).</summary>
        private void AddCatch()
        {
            Catches++;
            if (OnCatchCountChanged != null) OnCatchCountChanged(Catches);
            if (PhotonNetwork.LocalPlayer != null)
                PhotonNetwork.LocalPlayer.SetCustomProperties(new Hashtable { { HideSeekConstants.PropCatches, Catches } });
            if (GameManager.Instance != null && controller != null && controller.Role == GameRole.Seeker)
                GameManager.Instance.OnSeekerCatch(Catches);
        }

        /// <summary>Tulis hp/alive/surviveMs ke custom property lokal (leaderboard + late joiner).</summary>
        public void WriteStatsToPlayerProperties()
        {
            if (PhotonNetwork.LocalPlayer == null) return;
            int surviveMs = 0;
            GameManager gm = GameManager.Instance;
            if (gm != null && gm.RoundStartTime > 0f)
                surviveMs = Mathf.Max(0, Mathf.RoundToInt((Time.time - gm.RoundStartTime) * 1000f));

            PhotonNetwork.LocalPlayer.SetCustomProperties(new Hashtable
            {
                { HideSeekConstants.PropHp, Hp },
                { HideSeekConstants.PropAlive, !IsDead },
                { HideSeekConstants.PropSurviveMs, surviveMs },
                { HideSeekConstants.PropCatches, Catches }
            });
        }

        // ========================== SENTUHAN LANGSUNG ===========================

        /// <summary>Kontak trigger (badan Seeker masuk trigger Hider) -> damage otomatis.</summary>
        private void OnTriggerStay2D(Collider2D other)
        {
            HandleContact(other != null ? other.gameObject : null);
        }

        /// <summary>Kontak solid (collider biasa) -> damage otomatis, untuk prefab tanpa trigger.</summary>
        private void OnCollisionStay2D(Collision2D collision)
        {
            HandleContact(collision != null ? collision.gameObject : null);
        }

        /// <summary>
        /// "Jika disentuh Seeker, HP berkurang 1": hanya OWNER hider yang memutuskan
        /// (interval contactDamageInterval) lalu broadcast hasilnya lewat RPC.
        /// </summary>
        private void HandleContact(GameObject other)
        {
            if (pv == null || !pv.IsOwner) return;         // hanya owner yang memvalidasi
            if (IsDead || controller == null || controller.Role != GameRole.Hider) return;
            if (Time.time - lastContactDamage < contactDamageInterval) return;
            if (other == null) return;

            var otherController = other.GetComponentInParent<PlayerController>();
            if (otherController == null || otherController.Role != GameRole.Seeker) return;

            Vector2 dir = (Vector2)transform.position - (Vector2)otherController.transform.position;
            if (dir.sqrMagnitude < 0.0001f) dir = Vector2.up;
            lastContactDamage = Time.time;

            int attacker = otherController.View != null && otherController.View.Owner != null
                ? otherController.View.Owner.ActorNumber : -1;
            ApplyDamageLocal(attacker, dir.normalized);
        }

        /// <summary>Samakan HP dengan custom property (dipanggil dari PlayerController saat menerima stream).</summary>
        public void OnRemoteSync()
        {
            if (pv == null || pv.IsOwner || pv.Owner == null) return;
            SyncFromProperties(pv.Owner);
        }

        private void SyncFromProperties(Player p)
        {
            int hp = HideSeekConstants.GetProp(p.CustomProperties, HideSeekConstants.PropHp, Hp);
            bool alive = HideSeekConstants.GetProp(p.CustomProperties, HideSeekConstants.PropAlive, !IsDead);
            int catches = HideSeekConstants.GetProp(p.CustomProperties, HideSeekConstants.PropCatches, Catches);

            bool changed = (hp != Hp) || (alive != !IsDead) || (catches != Catches);
            Hp = Mathf.Clamp(hp, 0, MaxHp);
            Catches = catches;
            if (changed)
            {
                if (OnHpChanged != null) OnHpChanged(Hp, MaxHp);
                if (controller != null && controller.IsGhost != !alive) controller.SetSpectator(!alive);
            }
        }

        // ============================== PUSHBACK ===============================

        /// <summary>Luncurkan karakter sejauh 3 meter (spesifikasi) dengan MovePosition agar tetap menabrak dinding.</summary>
        private void StartPushback(Vector2 dir)
        {
            if (pushRoutine != null) StopCoroutine(pushRoutine);
            pushRoutine = StartCoroutine(CoroutinePushback(dir));
        }

        private IEnumerator CoroutinePushback(Vector2 dir)
        {
            IsPushing = true;
            Vector2 start = transform.position;
            Vector2 end = start + dir * Mathf.Max(0f, pushbackDistance);
            float t = 0f;
            float dur = Mathf.Max(0.05f, pushbackDuration);

            while (t < dur)
            {
                t += Time.deltaTime;
                float k = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(t / dur));
                Vector2 p = Vector2.Lerp(start, end, k);

                if (controller != null && controller.body != null)
                {
                    controller.body.velocity = Vector2.zero;
                    controller.body.MovePosition(p);
                }
                else transform.position = p;

                yield return null;
            }
            IsPushing = false;
            pushRoutine = null;
        }

        // ================================ DEBUG ================================
        [Tooltip("true = log validasi hit (matikan di build).")]
        public bool verbose;

        /// <summary>DEV: pukul diri sendiri (uji pushback/HP tanpa Seeker).</summary>
        [ContextMenu("DEV: damage self")]
        public void DevDamageSelf()
        {
            if (pv != null && pv.IsOwner) ApplyDamageLocal(pv.Owner.ActorNumber, Vector2.up);
        }
    }
}
