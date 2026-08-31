// ============================================================================
//  PlayerRegistry.cs
//  Static "phonebook" pemain yang sedang aktif di scene.
//  Dipakai SeekerSkill.Radar (cari hider terdekat), GameManager (hitung hider hidup),
//  dan PlayerCombat (validasi target tangkapan) tanpa harus Physics.OverlapCircle.
//  Registrasi terjadi di OnEnable/OnDisable PlayerController, jadi selalu sinkron
//  dengan objek yang benar-benar ada di scene (termasuk setelah PhotonNetwork.Destroy).
// ============================================================================
using System.Collections.Generic;
using HideSeek.Core;
using HideSeek.Players;
using UnityEngine;

namespace HideSeek.Core
{
    public static class PlayerRegistry
    {
        // actorNumber -> controller. Dictionary agar lookup O(1).
        private static readonly Dictionary<int, PlayerController> byActor = new Dictionary<int, PlayerController>(16);

        public static int Count { get { return byActor.Count; } }

        /// <summary>Semua controller terdaftar (read-only view untuk UI/minimap).</summary>
        public static Dictionary<int, PlayerController> All { get { return byActor; } }

        /// <summary>Daftar semua hider yang masih hidup (dipakai Radar & win condition).</summary>
        public static readonly List<PlayerController> LivingHiders = new List<PlayerController>(12);

        /// <summary>Catat controller milik <paramref name="actorNumber"/>.</summary>
        public static void Register(int actorNumber, PlayerController controller)
        {
            if (actorNumber <= 0 || controller == null) return;
            byActor[actorNumber] = controller;
        }

        /// <summary>Hapus registrasi (dipanggil di OnDisable). Hanya bila memang milik controller itu.</summary>
        public static void Unregister(int actorNumber, PlayerController controller)
        {
            if (actorNumber <= 0) return;
            PlayerController existing;
            if (byActor.TryGetValue(actorNumber, out existing) && (controller == null || existing == controller))
            {
                byActor.Remove(actorNumber);
                LivingHiders.Remove(controller);
            }
        }

        /// <summary>Ambil controller milik player <see cref="Photon.Realtime.Player"/> tertentu.</summary>
        public static PlayerController Get(int actorNumber)
        {
            PlayerController c;
            return byActor.TryGetValue(actorNumber, out c) ? c : null;
        }

        /// <summary>Update daftar hider hidup. Dipanggil Host tiap pergantian state & tiap damage.</summary>
        public static void RefreshLivingHiders()
        {
            LivingHiders.Clear();
            foreach (KeyValuePair<int, PlayerController> kv in byActor)
            {
                PlayerController c = kv.Value;
                if (c == null) continue;
                if (c.Role != GameRole.Hider) continue;
                if (c.Combat == null || c.Combat.IsDead) continue;
                LivingHiders.Add(c);
            }
        }

        /// <summary>Jumlah hider yang masih hidup (win condition: 0 -> Seeker menang).</summary>
        public static int LivingHiderCount
        {
            get
            {
                int n = 0;
                foreach (PlayerController c in LivingHiders)
                {
                    if (c != null && c.Combat != null && !c.Combat.IsDead) n++;
                }
                return n;
            }
        }

        /// <summary>Cari Hider terdekat dari titik <paramref name="from"/> yang masih hidup.</summary>
        public static PlayerController FindNearestLivingHider(Vector2 from, float maxDistanceSqr = float.MaxValue)
        {
            RefreshLivingHiders();
            PlayerController best = null;
            float bestSqr = maxDistanceSqr;
            for (int i = 0; i < LivingHiders.Count; i++)
            {
                PlayerController c = LivingHiders[i];
                if (c == null) continue;
                float d = (c.NetPosition - from).sqrMagnitude;
                if (d < bestSqr)
                {
                    bestSqr = d;
                    best = c;
                }
            }
            return best;
        }

        /// <summary>Debug helper: cetak isi registry ke Console.</summary>
        [ContextMenu("Dump Registry")]
        public static void Dump()
        {
            Debug.Log("[HideSeek] PlayerRegistry: " + byActor.Count + " player(s), " +
                      LivingHiderCount + " hider(s) alive.");
        }

        /// <summary>Bersihkan semua (dipanggil NetworkManager saat LeaveRoom / scene change).</summary>
        public static void Clear()
        {
            byActor.Clear();
            LivingHiders.Clear();
        }
    }
}
