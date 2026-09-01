// ============================================================================
//  PlayerCamera.cs
//  Kamera orthographic top-down yang mengikuti:
//    - pemain lokal (saat hidup)
//    - Seeker (saat pemain lokal jadi hantu/penonton)  -> sesuai spesifikasi
//      "hider mati = hantu yang tidak bisa bergerak", tapi tetap bisa menonton.
//  Opsional clamp ke batas peta agar tidak melihat keluar level.
// ============================================================================
using HideSeek.Core;
using HideSeek.Game;
using HideSeek.Network;
using HideSeek.Players;
using Photon.Pun;
using UnityEngine;

namespace HideSeek.Utils
{
    [DisallowMultipleComponent]
    public class PlayerCamera : MonoBehaviour
    {
        [Header("Framing (2D top-down)")]
        [Tooltip("Ukuran ortho (setengah tinggi viewport dalam unit dunia). 8 = 16 unit terlihat vertikal.")]
        public float orthoSize = 8f;
        public Vector3 zOffset = new Vector3(0f, 0f, -10f);

        [Header("Follow")]
        [Tooltip("0 = snap, 0.1-0.2 = halus.")]
        public float smoothTime = 0.12f;
        [Tooltip("Melebar selama fase SEEK (biar kedua tim punya gambaran ruang).")]
        public bool zoomOutOnSeek = true;
        public float seekExtraSize = 1.5f;

        [Header("Zoom adaptif (parity web: Camera2D)")]
        [Tooltip("Bila true, lebar kamera diambil dari rasio konstanta CamIdleZoom/CamSeekZoom "
                  + "dan CamRunZoom (bukan dari seekExtraSize di atas).")]
        public bool useConstantZoomRatio = true;
        [Tooltip("Melebar saat pemain lokal berlari penuh (bergerak dengan input maksimum).")]
        public bool zoomOutOnRun = true;
        [Tooltip("Ambang kecepatan (unit/detik) untuk dianggap "lari".")]
        public float runSpeedThreshold = HideSeekConstants.CamRunSpeed;

        [Header("Boundary (opsional)")]
        public bool clampToBoundary = false;
        public Vector2 boundaryMin = new Vector2(-24f, -14f);
        public Vector2 boundaryMax = new Vector2(24f, 14f);

        [Tooltip("Target manual (override follow). Kosong = otomatis.")]
        public Transform targetOverride;

        private Camera cam;
        private Vector3 velocity;
        private float baseSize;

        private void Awake()
        {
            cam = GetComponent<Camera>();
            if (cam == null) cam = Camera.main;
            if (cam == null) { Debug.LogError("[HideSeek] PlayerCamera butuh Camera di GameObject yang sama.", this); enabled = false; return; }
            cam.orthographic = true;
            baseSize = orthoSize;
            cam.orthographicSize = baseSize;
        }

        private void LateUpdate()
        {
            Transform t = ResolveTarget();
            if (t == null) return;

            // ---- zoom adaptif (sumber angka yang sama dengan web) ----
            // Base = kondisi TERDEKAT (zoomIdle). "Melebar" = orthoSize dikali rasio zoom.
            GameManager gm = GameManager.Instance;
            float want = WantedSize(gm, t);
            if (!Mathf.Approximately(cam.orthographicSize, want))
                cam.orthographicSize = Mathf.Lerp(cam.orthographicSize, want, Time.deltaTime * 3f);

            Vector3 dest = new Vector3(t.position.x, t.position.y, transform.position.z) + zOffset;
            dest.z = cam.transform.position.z;
            if (clampToBoundary) dest = Clamp(dest);

            // SmoothDamp memakai smoothTime (0 = snap); web memakai angka yang sama (CamSmoothTime).
            transform.position = Vector3.SmoothDamp(transform.position, dest, ref velocity, Mathf.Max(0.01f, smoothTime));
        }

        /// <summary>
        /// Ukuran ortho yang diinginkan. idle < run < seek (makin besar = makin lebar).
        /// Dengan useConstantZoomRatio rasio diambil dari HideSeekConstants supaya angka Unity
        /// dan web (CFG.camIdle/camRun/camSeek) tidak pernah berbeda.
        /// </summary>
        private float WantedSize(GameManager gm, Transform target)
        {
            float want = baseSize;
            if (!useConstantZoomRatio)
            {
                if (zoomOutOnSeek && gm != null && gm.State == GameState.SeekPhase) want = baseSize + seekExtraSize;
                return want;
            }
            if (zoomOutOnSeek && gm != null && gm.State == GameState.SeekPhase)
                want = baseSize * Ratio(HideSeekConstants.CamSeekZoom);
            if (zoomOutOnRun && IsRunning(target))
                want = Mathf.Max(want, baseSize * Ratio(HideSeekConstants.CamRunZoom));
            return want;
        }

        /// <summary>zoomIdle / zoom = faktor pelebaran (zoom <= 0 dianggap 1 supaya tidak habis).</summary>
        private static float Ratio(float zoom)
        {
            float z = Mathf.Max(0.05f, zoom);
            return HideSeekConstants.CamIdleZoom / z;
        }

        /// <summary>"Lari" = input gerak maksimum (joystick ditekan penuh). Murah: tanpa raycast.</summary>
        private static bool IsRunning(Transform target)
        {
            PlayerController pc = target != null ? target.GetComponent<PlayerController>() : null;
            if (pc == null || pc.IsGhost) return false;
            return pc.MoveInput.sqrMagnitude >= 0.9f * 0.9f;
        }

        /// <summary>Pilih target: pemain lokal -> (bila hantu) Seeker -> siapa saja.</summary>
        private Transform ResolveTarget()
        {
            if (targetOverride != null) return targetOverride;

            PlayerController me = PhotonNetwork.LocalPlayer != null
                ? PlayerRegistry.Get(PhotonNetwork.LocalPlayer.ActorNumber) : null;

            if (me != null && !me.IsGhost) return me.transform;

            PlayerController seeker = GameManager.Instance != null ? GameManager.Instance.Seeker : null;
            if (seeker != null) return seeker.transform;

            return me != null ? me.transform : null;
        }

        /// <summary>Jaga kamera tetap di dalam peta (memperhitungkan aspect ratio).</summary>
        private Vector3 Clamp(Vector3 pos)
        {
            float halfH = cam.orthographicSize;
            float halfW = halfH * Mathf.Max(0.1f, cam.aspect);

            Vector2 min = boundaryMin, max = boundaryMax;
            if (max.x - min.x > 2f * halfW)
            {
                pos.x = Mathf.Clamp(pos.x, min.x + halfW, max.x - halfW);
                pos.y = Mathf.Clamp(pos.y, min.y + halfH, max.y - halfH);
            }
            else
            {
                pos.x = (min.x + max.x) * 0.5f;
                pos.y = (min.y + max.y) * 0.5f;
            }
            return pos;
        }

        /// <summary>DEV: setortho dari inspector saat play.</summary>
        private void OnValidate()
        {
            if (cam != null && !Mathf.Approximately(baseSize, orthoSize))
            {
                baseSize = orthoSize;
                cam.orthographicSize = baseSize;
            }
        }
    }
}
