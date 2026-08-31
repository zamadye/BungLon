// ============================================================================
//  SeekerSkill.cs   (SCRIPT #6 - wajib)
//  Dua skill aktif Seeker, cooldown 8 detik:
//    Slot 0 - RADAR: menandai 1 Hider TERDEKAT dengan lingkaran merah di minimap
//             selama 1 detik. Hanya casternya yang melihat (informasi = keunggulan
//             Seeker), posisi dikirim juga ke Host (Authority) untuk telemetri.
//    Slot 1 - SONIC BLAST: gelombang suara radius 5 unit; semua Hider di radius
//             kena slow 50% selama 2 detik. Ring visual di-broadcast lewat [PunRPC],
//             penerapan slow lewat RaiseEvent RELIABLE per korban (hemat, tanpa RPC
//             ke view yang bukan milik kita).
// ============================================================================
using ExitGames.Client.Photon;
using HideSeek.Core;
using HideSeek.Game;
using HideSeek.Players;
using HideSeek.Network;
using HideSeek.UI;
using HideSeek.Utils;
using Photon.Pun;
using UnityEngine;

namespace HideSeek.Skills
{
    [RequireComponent(typeof(PlayerController))]
    [RequireComponent(typeof(PlayerController))]
    public class SeekerSkill : MonoBehaviourPun
    {
        // ============================ INSPECTOR ================================
        [Header("References (assign manual)")]
        public PlayerController controller;

        [Tooltip("Minimap tempat lingkaran radar digambar (boleh null -> hanya debug log).")]
        public MinimapRadarView minimap;

        [Tooltip("Prefab ring Sonic Blast (SpriteRenderer/Particles). Kosong -> Resources/HideSeek/SonicBlastRing -> kotak sementara.")]
        public GameObject blastRingPrefab;

        [Header("Tuning")]
        [Tooltip("Cooldown kedua skill (detik). Spesifikasi: 8 s.")]
        public float cooldown = HideSeekConstants.SeekerSkillCooldown;

        [Tooltip("Radius Sonic Blast (unit). Spesifikasi: 5.")]
        public float blastRadius = HideSeekConstants.SonicBlastRadius;

        [Tooltip("Faktor kecepatan korban (0.5 = 50% slow).")]
        public float slowFactor = HideSeekConstants.SonicSlowFactor;

        [Tooltip("Durasi slow (detik). Spesifikasi: 2.")]
        public float slowDuration = HideSeekConstants.SonicSlowDuration;

        [Tooltip("Durasi lingkaran radar di minimap (detik). Spesifikasi: 1.")]
        public float radarDuration = 1.0f;

        [Tooltip("Jarak maksimum radar mencari hider (unit). Sangat besar = seluruh map.")]
        public float radarMaxRange = 1000f;

        [Tooltip("Warna ring blast.")]
        public Color blastColor = new Color(1f, 0.85f, 0.2f, 0.9f);

        // =============================== STATE =================================
        public float CooldownRemaining { get { return Mathf.Max(0f, cooldownUntil - Time.time); } }
        public bool IsReady { get { return CooldownRemaining <= 0f; } }

        private float cooldownUntil;
        private PhotonView pv;
        private Coroutine ringRoutine;

        private const byte SlotRadar = 0;
        private const byte SlotSonic = 1;

        // ============================== LIFECYCLE ===============================
        private void Awake()
        {
            pv = GetComponent<PhotonView>();
            if (controller == null) controller = GetComponent<PlayerController>();
            if (minimap == null && UIManager.Instance != null) minimap = UIManager.Instance.Minimap;
            if (blastRingPrefab == null) blastRingPrefab = PrefabLibrary.Resolve(blastRingPrefab, HideSeekPrefabs.SonicRing, false);
        }

        // ============================= PUBLIC API ==============================

        /// <summary>UI memanggil ini. 0 = Radar, 1 = Sonic Blast.</summary>
        public void TryUseSkill(int slot)
        {
            if (pv == null || !pv.IsOwner) return;
            if (controller == null || controller.Role != GameRole.Seeker) return;
            if (controller.IsGhost) return;

            GameManager gm = GameManager.Instance;
            if (gm != null && !gm.CanUseSkills(GameRole.Seeker))
            {
                Toast("Skill Seeker hanya bisa dipakai saat SEEK PHASE.");
                return;
            }
            if (!IsReady) { Toast("Cooldown: " + CooldownRemaining.ToString("0.0") + "s"); return; }

            if (slot == SlotRadar) CastRadar();
            else CastSonicBlast();

            StartCooldown();
        }

        /// <summary>Notifikasi dari PlayerController saat Host mengganti role.</summary>
        public void OnRoleChanged(GameRole role)
        {
            if (role != GameRole.Seeker) ResetForRound();
        }

        /// <summary>Apakah tombol skill boleh aktif?</summary>
        public bool SkillsAvailable { get { return controller != null && controller.Role == GameRole.Seeker && !controller.IsGhost; } }

        /// <summary>Reset saat ronde baru (dipanggil PlayerController.ResetForRound).</summary>
        public void ResetForRound()
        {
            cooldownUntil = 0f;
            if (ringRoutine != null) { StopCoroutine(ringRoutine); ringRoutine = null; }
        }

        // ============================== SKILL #1 =================================

        /// <summary>
        /// RADAR: cari Hider hidup terdekat, tampilkan lingkaran merah 1 detik di minimap.
        /// Tidak ada data posisi yang disebar ke klien lain (hanya Host dapat telemetri),
        /// jadi informasi ini benar-benar menjadi keunggulan Seeker.
        /// </summary>
        private void CastRadar()
        {
            PlayerController target = PlayerRegistry.FindNearestLivingHider(transform.position,
                                                                            radarMaxRange * radarMaxRange);
            if (target == null)
            {
                Toast("Radar: tidak ada Hider terdeteksi.");
                // tetap pendinginkan cooldown agar tidak di-spam
                return;
            }

            Vector2 pos = target.NetPosition;
            if (minimap != null) minimap.ShowRadarPing(pos, radarDuration);
            string who = target.View != null && target.View.Owner != null ? target.View.Owner.NickName : "Hider";
            if (UIManager.Instance != null) UIManager.Instance.ShowToast("Radar: " + who + " terdeteksi!");

            // Telemetri ke Authority (host) - dipakai untuk log/stats, tidak menggerakkan apa pun.
            var content = new Hashtable { { "x", pos.x }, { "y", pos.y }, { "d", radarDuration } };
            Net.RaiseMaster(HideSeekConstants.EvtRadar, content, false);
        }

        // ============================== SKILL #2 =================================

        /// <summary>
        /// SONIC BLAST: ring meledak di posisi caster (visual untuk semua klien),
        /// lalu pemilik blast mendeteksi hider dalam radius dan mengirim slow ke mereka.
        /// </summary>
        private void CastSonicBlast()
        {
            Vector2 origin = transform.position;
            pv.RPC(nameof(RpcBlast), RpcTarget.All, origin.x, origin.y, blastRadius);
        }

        /// <summary>[PunRPC] Semua klien: buat ring + (hanya caster) terapkan slow ke hider dalam radius.</summary>
        [PunRPC]
        private void RpcBlast(float x, float y, float radius)
        {
            SpawnRing(new Vector2(x, y), radius);

            if (pv == null || !pv.IsOwner) return;

            // Area of effect dihitung oleh satu orang (caster) -> konsisten & hemat:
            // kita hanya mengirim 1 event kecil ke tiap korban (lihat Net di bawah).
            PlayerRegistry.RefreshLivingHiders();
            var list = PlayerRegistry.LivingHiders;
            float r2 = radius * radius;

            for (int i = 0; i < list.Count; i++)
            {
                PlayerController hider = list[i];
                if (hider == null || hider.Combat == null || hider.Combat.IsDead) continue;
                if ((hider.NetPosition - new Vector2(x, y)).sqrMagnitude > r2) continue;

                int actor = hider.View != null && hider.View.Owner != null ? hider.View.Owner.ActorNumber : 0;
                if (actor <= 0) continue;

                // RaiseEvent RELIABLE per korban: lebih ringan daripada PunRPC ke view milik orang lain
                // (yang tidak diizinkan PUN2) dan tetap terjamin sampai.
                var content = new Hashtable
                {
                    { "a", actor }, { "f", slowFactor }, { "d", slowDuration }
                };
                Net.RaiseAll(HideSeekConstants.EvtSlow, content, true);
            }
        }

        /// <summary>Buat efek ring (prefab atau kotak sementara) yang melebar lalu hilang.</summary>
        private void SpawnRing(Vector2 worldPos, float radius)
        {
            GameObject go;
            if (blastRingPrefab != null)
            {
                go = Instantiate(blastRingPrefab, worldPos, Quaternion.identity);
            }
            else
            {
                // Fallback tanpa aset: quad + sprite kotak agar tetap terlihat di build placeholder.
                go = new GameObject("SonicRing_tmp");
                go.transform.position = worldPos;
                var sr = go.AddComponent<SpriteRenderer>();
                sr.sprite = CreateCircleSprite();
                sr.color = blastColor;
                sr.sortingOrder = 500;
            }

            var fx = go.GetComponent<SonicBlastEffect>();
            if (fx == null) fx = go.AddComponent<SonicBlastEffect>();
            fx.Play(radius, 0.45f);
        }

        // ============================ EVENT: SLOW ==============================
        // Penerapan slow dilakukan oleh korban sendiri, di PlayerController.OnEvent()
        // (komponen movement) - supaya efeknya selalu konsisten dengan state lokal.

        // ============================== COOLDOWN ===============================
        private void StartCooldown()
        {
            cooldownUntil = Time.time + Mathf.Max(0.1f, cooldown);
            int actor = PhotonNetwork.LocalPlayer != null ? PhotonNetwork.LocalPlayer.ActorNumber : 0;
            Net.SyncCooldown(actor, SlotSonic, cooldown);
        }

        // ================================ UTILS ================================
        private static Sprite circleSprite;

        /// <summary>Sprite lingkaran garis sederhana (dipakai bila tidak ada aset ring).</summary>
        private static Sprite CreateCircleSprite()
        {
            if (circleSprite != null) return circleSprite;

            const int size = 128;
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, false);
            Color clear = new Color(0, 0, 0, 0);
            float r = size * 0.5f;
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    float dx = x - r + 0.5f, dy = y - r + 0.5f;
                    float d = Mathf.Sqrt(dx * dx + dy * dy);
                    float a = 1f - Mathf.Clamp01(Mathf.Abs(d - (r - 12f)) / 10f);
                    tex.SetPixel(x, y, new Color(1f, 1f, 1f, a));
                }
            }
            tex.Apply();
            circleSprite = Sprite.Create(tex, new Rect(0, 0, size, size), new Vector2(0.5f, 0.5f), size);
            return circleSprite;
        }

        private static void Toast(string msg)
        {
            if (UIManager.Instance != null) UIManager.Instance.ShowToast(msg);
        }
    }
}
