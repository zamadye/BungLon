// ============================================================================
//  HiderSkill.cs   (SCRIPT #5 - wajib)
//  Dua skill aktif Hider, cooldown 10 detik:
//    Slot 0 - KAMUFLASE (Match Color): baca rata-rata warna di bawah karakter
//             (CamouflageHelper + Physics2D raycast ke bawah) lalu lerp warna
//             sprite ke warna itu. Warna hasil di-broadcast lewat [PunRPC] supaya
//             Seeker melihat kamuflase yang sama (visual = gameplay).
//    Slot 1 - PROP SWAP: berubah jadi prop acak dari PropDatabase selama 8 detik.
//             Bila ada input gerak selama jadi prop -> efek BATAL (sesuai spesifikasi).
//  Cooldown diumumkan ke room lewat RaiseEvent UNRELIABLE (hemat, lihat Net.SyncCooldown).
// ============================================================================
using System.Collections;
using ExitGames.Client.Photon;
using HideSeek.Core;
using HideSeek.Game;
using HideSeek.Players;
using HideSeek.UI;
using HideSeek.Utils;
using Photon.Pun;
using UnityEngine;

namespace HideSeek.Skills
{
    [RequireComponent(typeof(PlayerController))]
    [RequireComponent(typeof(PlayerController))]
    [RequireComponent(typeof(CamouflageHelper))]
    [RequireComponent(typeof(PlayerVisual))]
    public class HiderSkill : MonoBehaviourPunCallbacks, IOnEventCallback
    {
        // ============================ INSPECTOR ================================
        [Header("References (assign manual)")]
        public PlayerController controller;
        [Tooltip("Utility pengambil rata-rata warna tanah. Boleh di-attach di objek pemain.")]
        public CamouflageHelper camouflage;
        public PlayerVisual visual;

        [Header("Props")]
        [Tooltip("ScriptableObject daftar prop (Create > HideSeek > Prop Database). Kosong = load Resources/HideSeek/PropDatabase.")]
        public PropDatabase props;

        [Header("Tuning")]
        [Tooltip("Cooldown kedua skill (detik). Spesifikasi: 10 s.")]
        public float cooldown = HideSeekConstants.HiderSkillCooldown;

        [Tooltip("Durasi prop swap (0 = pakai nilai PropDatabase / 8 detik).")]
        [Range(0f, 30f)] public float propDurationOverride = 0f;

        [Tooltip("Kecepatan lerp warna kamuflase.")]
        public float camoLerpSpeed = 8f;

        [Tooltip("Simpangan warna maksimum agar tetap sedikit terlihat (0 = 100% match).")]
        [Range(0f, 0.25f)] public float camoNoise = 0.02f;

        [Tooltip("Sorting layer untuk prop (agar menutupi karakter dengan benar). Kosong = sama seperti pemain.")]
        public string propSortingLayer = "";

        // =============================== STATE =================================
        /// <summary>Sisa cooldown (detik, clock lokal). Dipakai UIManager untuk mengisi tombol.</summary>
        public float CooldownRemaining { get { return Mathf.Max(0f, cooldownUntil - Time.time); } }
        public bool IsReady { get { return CooldownRemaining <= 0f; } }

        private float cooldownUntil;
        private bool camoActive;
        private Color camoTarget = Color.white;
        private bool inPropMode;
        private GameObject propInstance;
        private Coroutine propRoutine;
        private int lastSkillFlashFrame = -1;

        /// <summary>True saat sedang menjadi prop (dipakai UI & input).</summary>
        public bool InPropMode { get { return inPropMode; } }

        private PhotonView pv;   // diisi di Awake

        private const byte SlotCamo = 0;
        private const byte SlotProp = 1;

        // ============================== LIFECYCLE ================================
        private void Awake()
        {
            pv = GetComponent<PhotonView>();
            if (controller == null) controller = GetComponent<PlayerController>();
            if (visual == null) visual = GetComponent<PlayerVisual>();
            if (camouflage == null) camouflage = GetComponent<CamouflageHelper>();
            if (props == null) props = PropDatabase.LoadDefault();

            if (camouflage == null)
                Debug.LogWarning("[HideSeek] HiderSkill: CamouflageHelper belum di-attach -> skill Match Color akan fallback ke warna tanah rata-rata.", this);
        }

        private void Update()
        {
            // Hanya pemilik objek yang boleh memproses input & pembatalan prop.
            if (pv == null || !pv.IsOwner) return;

            // Lerp halus menuju warna kamuflase (biar tidak "pop").
            if (camoActive && visual != null && camoLerpSpeed > 0f)
                visual.TintAll(Color.Lerp(CurrentTint(), camoTarget, Time.deltaTime * camoLerpSpeed));

            // Aturan spesifikasi: bergerak saat jadi prop membatalkan efek.
            if (inPropMode && controller != null && controller.MoveInput.sqrMagnitude > 0.02f)
                EndPropMode(true);
        }

        private Color CurrentTint()
        {
            return visual != null && visual.renderers != null && visual.renderers.Count > 0 && visual.renderers[0] != null
                ? visual.renderers[0].color
                : Color.white;
        }

        // ============================= PUBLIC API ==============================

        /// <summary>Tombol skill UI memanggil ini. 0 = Match Color, 1 = Prop Swap.</summary>
        public void TryUseSkill(int slot)
        {
            if (pv == null || !pv.IsOwner) return;
            if (controller == null || controller.Role != GameRole.Hider) return;
            if (controller.IsGhost) return;

            GameManager gm = GameManager.Instance;
            if (gm != null && !gm.CanUseSkills(GameRole.Hider))
            {
                Toast("Skill belum bisa dipakai pada fase ini.");
                return;
            }
            if (!IsReady)
            {
                Toast("Cooldown: " + CooldownRemaining.ToString("0.0") + "s");
                return;
            }
            if (props == null) props = PropDatabase.LoadDefault();

            bool used = slot == SlotCamo ? CastMatchColor() : CastPropSwap();
            if (used) StartCooldown((byte)slot);
        }

        /// <summary>Bersihkan efek saat ronde baru (dipanggil PlayerController.ResetForRound).</summary>
        public void ResetForRound()
        {
            cooldownUntil = 0f;
            camoActive = false;
            if (propRoutine != null) { StopCoroutine(propRoutine); propRoutine = null; }
            DestroyPropInstance();
            inPropMode = false;
            if (visual != null)
            {
                visual.SetVisible(true);
                visual.ResetToBase();
            }
        }

        /// <summary>Apakah tombol skill boleh aktif? (dipakai UIManager untuk enable/interact).</summary>
        public bool SkillsAvailable { get { return controller != null && controller.Role == GameRole.Hider && !controller.IsGhost; } }

        /// <summary>Notifikasi dari PlayerController saat Host mengganti role.</summary>
        public void OnRoleChanged(GameRole role)
        {
            if (role != GameRole.Hider) ResetForRound();
        }

        // ============================== SKILL #1 =================================

        /// <summary>
        /// KAMUFLASE: sampling warna tanah di bawah karakter -> broadcast warna.
        /// Return false bila tidak ada permukaan (mis. hider berdiri di atas jurang).
        /// </summary>
        private bool CastMatchColor()
        {
            Color avg;
            if (camouflage != null)
            {
                Collider2D ground;
                if (!camouflage.RequestAverageColor(transform.position, out avg, out ground))
                {
                    Toast("Tidak ada permukaan di bawah kaki.");
                    return false;
                }
                if (camoNoise > 0f)
                {
                    // sedikit variasi agar tidak 100% identik dengan tile di sekitarnya
                    float n = Random.Range(-camoNoise, camoNoise);
                    avg = new Color(Mathf.Clamp01(avg.r + n), Mathf.Clamp01(avg.g + n), Mathf.Clamp01(avg.b + n), 1f);
                }
            }
            else
            {
                // Fallback tanpa CamouflageHelper: pakai warna tile terdekat dari Renderer ground.
                avg = FallbackGroundColor();
            }

            camoTarget = avg;
            camoActive = true;
            pv.RPC(nameof(RpcSetCamo), RpcTarget.All, avg.r, avg.g, avg.b);
            return true;
        }

        /// <summary>[PunRPC] Semua klien menerapkan warna kamuflase yang sama.</summary>
        [PunRPC]
        private void RpcSetCamo(float r, float g, float b)
        {
            camoTarget = new Color(r, g, b, 1f);
            camoActive = true;
            if (visual != null) visual.TintAll(camoTarget);
        }

        /// <summary>Warna renderer ground terdekat bila CamouflageHelper tidak terpasang.</summary>
        private Color FallbackGroundColor()
        {
            Collider2D col = Physics2D.OverlapPoint(new Vector2(transform.position.x, transform.position.y - 0.6f),
                                                     1 << HideSeekConstants.GroundLayerIndex,
                                                     QueryTriggerInteraction.Collide);
            var sr = col != null ? col.GetComponent<SpriteRenderer>() : null;
            return sr != null ? sr.color : Color.gray;
        }

        // ============================== SKILL #2 =================================

        /// <summary>
        /// PROP SWAP: ganti model dengan prop acak selama propDuration detik.
        /// Semua klien instantiate prop yang sama (ID dikirim lewat RPC) agar visual konsisten.
        /// </summary>
        private bool CastPropSwap()
        {
            if (inPropMode) { EndPropMode(true); return false; }      // tekan lagi = keluar (tanpa cooldown)
            if (props == null || props.Count == 0) { Toast("PropDatabase kosong."); return false; }

            PropDatabase.PropEntry entry = props.Pick(unchecked(MyActor() * 977 + Time.frameCount));
            if (entry == null) { Toast("Prop tidak tersedia."); return false; }

            float dur = propDurationOverride > 0f ? propDurationOverride : props.SwapDuration;
            pv.RPC(nameof(RpcPropSwap), RpcTarget.All, entry.id, dur);
            return true;
        }

        /// <summary>[PunRPC] Mulai mode prop (semua klien) + timer otomatis berakhir.</summary>
        [PunRPC]
        private void RpcPropSwap(byte propId, float duration)
        {
            BeginPropMode(propId, duration);
        }

        /// <summary>[PunRPC] Berhenti mode prop (dipanggil saat dibatalkan karena bergerak).</summary>
        [PunRPC]
        private void RpcPropEnd()
        {
            EndPropMode(false);
        }

        /// <summary>Pasang prop di posisi pemain, sembunyikan sprite karakter, kunci gerak.</summary>
        private void BeginPropMode(byte propId, float duration)
        {
            PropDatabase.PropEntry entry = props != null ? props.Get(propId) : null;
            if (entry == null && props != null) entry = props.Get(props.FallbackId());

            GameObject prefab = entry != null ? entry.ResolvePrefab() : null;
            if (prefab == null)
            {
                Toast("Prefab prop tidak ditemukan (id=" + propId + ").");
                return;
            }

            inPropMode = true;
            if (visual != null) visual.SetVisible(false);

            propInstance = Instantiate(prefab, transform.position, Quaternion.identity, transform);
            propInstance.transform.localPosition = Vector3.zero;
            if (entry.localScale != Vector3.zero) propInstance.transform.localScale = entry.localScale;
            TintProp(entry.tintColor);   // tint selalu dipakai (placeholder prop hanya 1 sprite)
            if (!string.IsNullOrEmpty(propSortingLayer)) SetPropSortingLayer(propSortingLayer);

            if (controller != null) controller.FreezeForProp(true);

            if (propRoutine != null) StopCoroutine(propRoutine);
            propRoutine = StartCoroutine(CoroutinePropExpire(Mathf.Max(0.2f, duration)));
        }

        /// <summary>Hentikan mode prop. <paramref name="broadcast"/> = kirim RPC ke klien lain.</summary>
        private void EndPropMode(bool broadcast)
        {
            if (!inPropMode) return;
            inPropMode = false;

            if (propRoutine != null) { StopCoroutine(propRoutine); propRoutine = null; }
            DestroyPropInstance();

            if (visual != null)
            {
                visual.SetVisible(true);
                if (camoActive) visual.TintAll(camoTarget);   // kamuflase tetap berlaku setelah jadi prop
                else visual.ResetToBase();
            }
            if (controller != null) controller.FreezeForProp(false);

            if (broadcast && pv != null && pv.IsOwner) pv.RPC(nameof(RpcPropEnd), RpcTarget.All);
        }

        private void DestroyPropInstance()
        {
            if (propInstance != null) Destroy(propInstance);
            propInstance = null;
        }

        private IEnumerator CoroutinePropExpire(float duration)
        {
            yield return new WaitForSeconds(duration);
            EndPropMode(true);
        }

        // MonoBehaviourPunCallbacks mendaftarkan callback target di OnEnable/OnDisable -> panggil base.
        public override void OnEnable() { base.OnEnable(); }
        public override void OnDisable() { base.OnDisable(); DestroyPropInstance(); inPropMode = false; }

        // ============================ COOLDOWN =================================

        /// <summary>
        /// Hapus cooldown (hadiah rewarded ad). Slot dikirim supaya UI semua klien ikut bersih.
        /// </summary>
        public void SkipCooldown(byte slot)
        {
            cooldownUntil = 0f;
            Net.SyncCooldown(MyActor(), slot, 0f);
        }

        /// <summary>Mulai cooldown lokal + umumkan sisa durasinya ke room (event unreliable).</summary>
        private void StartCooldown(byte slot)
        {
            cooldownUntil = Time.time + Mathf.Max(0.1f, cooldown);
            Net.SyncCooldown(MyActor(), slot, cooldown);
        }

        /// <summary>
        /// Terima pengumuman cooldown (dari diri sendiri / orang lain).
        /// Untuk diri sendiri: koreksi drift; untuk orang lain: flash kecil agar Seeker tahu skill baru dipakai.
        /// </summary>
        public void OnEvent(EventData photonEvent)
        {
            if (photonEvent.Code != HideSeekConstants.EvtSkillUsed) return;
            var p = photonEvent.CustomData as Hashtable;
            if (p == null) return;

            int actor = HideSeekConstants.GetProp(p, "a", 0);
            float remaining = HideSeekConstants.GetProp(p, "d", 0f);
            bool mine = PhotonNetwork.LocalPlayer != null && PhotonNetwork.LocalPlayer.ActorNumber == actor;

            // Cooldown pemain lain tidak relevan untuk UI kita -> abaikan (hemat kerja).
            if (!mine) return;

            // Echo dari diri sendiri: sinkronkan supaya tidak "double cooldown".
            if (cooldownUntil <= Time.time) cooldownUntil = Time.time + Mathf.Max(0f, remaining);
            if (Time.frameCount != lastSkillFlashFrame)
            {
                lastSkillFlashFrame = Time.frameCount;
                StartCoroutine(CoroutineSkillFlash());      // umpan balik visual saat skill diterima server
            }
        }

        /// <summary>Flash singkat 0.15 detik pada pemain yang memakai skill (indikator visual murah).</summary>
        private IEnumerator CoroutineSkillFlash()
        {
            if (visual == null || inPropMode) yield break;
            Color c = CurrentTint();
            visual.TintAll(Color.Lerp(c, Color.white, 0.6f));
            yield return new WaitForSeconds(0.15f);
            visual.TintAll(c);
        }

        // ============================== HELPERS ================================

        private int MyActor()
        {
            return pv != null && pv.Owner != null ? pv.Owner.ActorNumber : 0;
        }

        private void TintProp(Color c)
        {
            if (propInstance == null) return;
            var srs = propInstance.GetComponentsInChildren<SpriteRenderer>();
            for (int i = 0; i < srs.Length; i++) srs[i].color = c;
        }

        private void SetPropSortingLayer(string layer)
        {
            if (propInstance == null) return;
            var srs = propInstance.GetComponentsInChildren<SpriteRenderer>();
            for (int i = 0; i < srs.Length; i++) srs[i].sortingLayerName = layer;
        }

        private static void Toast(string msg)
        {
            if (UIManager.Instance != null) UIManager.Instance.ShowToast(msg);
        }
    }
}
