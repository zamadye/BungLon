// ============================================================================
//  MobileJoystick.cs
//  Joystick virtual UI (kiri bawah) untuk movement Hider/Seeker di mobile.
//  Cara pakai: assign background + handle, lalu daftarkan ke UIManager.Joystick
//  (atau langsung ke PlayerController.joystick). Keyboard (WASD) tetap jalan.
//
//  Catatan multi-touch: memakai pointerId sehingga joystick & tap-to-catch
//  bisa ditekan bersamaan tanpa saling mengganggu.
// ============================================================================
using UnityEngine;
using UnityEngine.EventSystems;

namespace HideSeek.UI
{
    [DisallowMultipleComponent]
    public class MobileJoystick : MonoBehaviour, IPointerDownHandler, IDragHandler, IPointerUpHandler
    {
        [Header("Referensi (assign manual)")]
        [Tooltip("Background joystick. Bila kosong, transform objek ini dipakai.")]
        public RectTransform background;

        [Tooltip("Handle (yang bergerak).")]
        public RectTransform handle;

        [Header("Perilaku")]
        [Tooltip("Radius gerak handle dalam pixel (0 = otomatis dari lebar background).")]
        public float radius = 0f;

        [Tooltip("true = joystick mengikuti posisi sentuhan pertama (floating) - nyaman untuk layar kecil.")]
        public bool floatingOrigin = true;

        [Tooltip("Deadzone output (magnitude di bawah nilai ini dianggap nol).")]
        [Range(0f, 0.5f)] public float deadzone = 0.12f;

        [Tooltip("Magnitude output saat handle di tepi (1 = penuh).")]
        [Range(0.1f, 1f)] public float maxOutput = 1f;

        /// <summary>Input ter-normalisasi ( magnitude 0..1 ). Dibaca PlayerController.</summary>
        public Vector2 Direction { get; private set; }

        /// <summary>True sejak pointerdown sampai pointerup (dipakai PlayerController untuk mematikan WASD bila joystick dipakai).</summary>
        public bool Active { get; private set; }

        private Vector2 origin;
        private Vector2 defaultAnchoredPos;
        private int trackedPointer = -1;

        private void Awake()
        {
            if (background == null) background = transform as RectTransform;
            if (handle == null && background != null)
            {
                for (int i = 0; i < background.childCount; i++)
                {
                    var rt = background.GetChild(i) as RectTransform;
                    if (rt != null) { handle = rt; break; }
                }
            }
            if (radius <= 0f && background != null) radius = background.rect.width * 0.5f;
            if (background != null)
            {
                defaultAnchoredPos = background.anchoredPosition;
                origin = defaultAnchoredPos;
            }
            Active = false;
            Direction = Vector2.zero;
        }

        private void OnDisable()
        {
            Active = false;
            Direction = Vector2.zero;
            ResetHandle();
        }

        /// <summary>Pointer pertama kali menyentuh area joystick.</summary>
        public void OnPointerDown(PointerEventData eventData)
        {
            trackedPointer = eventData.pointerId;
            Active = true;

            if (floatingOrigin && background != null)
            {
                // Pindahkan background ke posisi sentuhan agar jempol tidak perlu "mencari".
                Vector2 localPoint;
                if (RectTransformUtility.ScreenPointToLocalPointInRectangle(
                        background.parent as RectTransform, eventData.position, eventData.pressEventCamera, out localPoint))
                {
                    background.anchoredPosition = localPoint;
                    origin = localPoint;   // sumber joystick ikut pindah
                }
            }
            OnDrag(eventData);
        }

        /// <summary>Gerak handle + tulis Direction.</summary>
        public void OnDrag(PointerEventData eventData)
        {
            if (eventData.pointerId != trackedPointer) return;

            Vector2 localPoint;
            RectTransform parent = background != null ? background.parent as RectTransform : null;
            if (parent == null) parent = background;
            if (parent == null) return;

            if (!RectTransformUtility.ScreenPointToLocalPointInRectangle(parent, eventData.position,
                    eventData.pressEventCamera, out localPoint))
                return;

            Vector2 delta = localPoint - origin;
            float mag = delta.magnitude;
            float r = Mathf.Max(1f, radius);

            if (mag > r) delta = delta * (r / mag);
            if (handle != null) handle.anchoredPosition = delta;

            float out01 = Mathf.Clamp01(mag / r);
            Vector2 dir = out01 < deadzone ? Vector2.zero : delta / r;
            dir = Vector2.ClampMagnitude(dir, 1f) * (maxOutput * out01);
            if (dir.sqrMagnitude < deadzone * deadzone) dir = Vector2.zero;

            Direction = dir;
        }

        /// <summary>Lepas jari: reset.</summary>
        public void OnPointerUp(PointerEventData eventData)
        {
            if (eventData.pointerId != trackedPointer) return;
            trackedPointer = -1;
            Active = false;
            Direction = Vector2.zero;
            ResetHandle();

            if (floatingOrigin && background != null) background.anchoredPosition = defaultAnchoredPos;
        }

        private void ResetHandle()
        {
            if (handle != null) handle.anchoredPosition = Vector2.zero;
        }
    }
}
