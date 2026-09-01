// ============================================================================
//  HudV2SkillButton.cs   (HUD v2 - tombol skill blueprint 3.2 / 3.3)
//  Satu komponen untuk 3 slot: 0 = Kamuflase / Radar, 1 = Prop Swap / Sonic Blast,
//  2 = Bekukan (Freeze, khusus Hider).
//
//  Yang dijamin kelas ini (aturan skill tetap di HiderSkill/SeekerSkill):
//   * ring cooldown melingkar (Image.Type = Filled) seperti web;
//   * label angka detik saat cooldown, huruf singkat saat siap (C/P/F, R/B utk Seeker);
//   * squash saat ditekan + getar halus (hanya perangkat mobile);
//   * MODE AIM utk slot Prop: TAHAN -> muncul kandidat -> seret/lepas di atasnya.
//     Lepas tanpa memilih = perilaku lama (game memilih prop), jadi pemanggil
//     lama (UIManager.OnSkillClicked) tidak berubah rasanya;
//   * slot 2 otomatis disembunyikan untuk Seeker.
//
//  Referensi di-assign manual di Inspector (tidak ada GameObject.Find di runtime).
// ============================================================================
using System.Collections.Generic;
using HideSeek.Core;
using HideSeek.Players;
using HideSeek.Skills;
using Photon.Pun;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace HideSeek.UI
{
    /// <summary>Tombol skill HUD v2: cooldown ring + press FX + mode aim untuk Prop.</summary>
    [DisallowMultipleComponent]
    [RequireComponent(typeof(RectTransform))]
    public class HudV2SkillButton : MonoBehaviour, IPointerDownHandler, IPointerUpHandler
    {
        // ============================ INSPECTOR ================================
        [Header("Identitas tombol")]
        [Tooltip("0 = Kamuflase/Radar, 1 = Prop Swap/Sonic Blast, 2 = Bekukan (khusus Hider).")]
        [Range(0, 2)] public int slot = 0;
        [Tooltip("Bila true, menahan tombol Prop (slot 1) membuka kandidat wujud untuk dipilih.")]
        public bool propAimMode = true;
        [Tooltip("Getar singkat saat ditekan (hanya berdampak di perangkat mobile).")]
        public bool haptic = true;

        [Header("Referensi UI (assign manual di Inspector)")]
        [Tooltip("Image dengan Image.Type = Filled sebagai ring cooldown.")]
        public Image ring;
        [Tooltip("Teks kecil di dalam tombol (sisa cooldown / huruf singkat).")]
        public Text label;
        [Tooltip("Ikon skill (mis. Icon_Camouflage / Icon_PropSwap / Icon_Freeze).")]
        public Image icon;
        [Tooltip("Ikon versi SEEKER utk slot yang sama (mis. Icon_Radar / Icon_SonicBlast). "
                 + "Kosong = pakai ikon di atas untuk kedua role, seperti HUD web yang menukar ikon per role.")]
        public Sprite seekerIcon;
        [Tooltip("Button pada objek ini. Kosong = dicari di children.")]
        public Button button;
        [Tooltip("Parent popup kandidat (bagus bila diberi Horizontal/Vertical Layout Group). Kosong = dibuat otomatis.")]
        public RectTransform popupRoot;
        [Tooltip("Prefab item popup: GameObject berisi Button + Text. Kosong = item dibuat sederhana.")]
        public GameObject popupItem;
        [Tooltip("UIManager tujuan. Kosong = pakai UIManager.Instance.")]
        public UIManager uiManager;

        // =============================== STATE =================================
        /// <summary>Maksimum kandidat wujud yang ditampilkan popup aim.</summary>
        public int maxChoices = MaxChoicesConst;
        private const int MaxChoicesConst = 6;
        private const float DragThresholdPx = 10f;

        private RectTransform rt;
        private Image frame;                       // gambar "bingkai" tombol (bukan ring/icon)
        private Sprite hiderIcon;                   // sprite awal icon, dipakai saat role Hider
        private readonly List<GameObject> popupKids = new List<GameObject>(8);

        private bool holding;
        private bool dragged;
        private bool consumed;                     // popup sudah memakai skill -> jangan tembak dua kali
        private Vector2 downPos;
        private byte chosenPropId;

        // ============================== LIFECYCLE ================================
        private void Awake()
        {
            rt = (RectTransform)transform;
            if (button == null) button = GetComponentInChildren<Button>(true);
            if (uiManager == null) uiManager = UIManager.Instance;
            if (ring != null) ring.type = Image.Type.Filled;
            frame = FindFrameImage();
            if (icon != null) hiderIcon = icon.sprite;
        }

        private void OnDisable() { ClosePopup(); holding = false; }

        private void Update()
        {
            PlayerController pc = Local();
            RefreshRoleVisibility(pc);
            RefreshCooldown(pc);
            // Seretan dipantau sendiri (tanpa IPointerMoveHandler agar tidak mengganggu EventSystem).
            if (holding && popupKids.Count > 0)
            {
                Vector3 d = Input.mousePosition - (Vector3)downPos;
                if (!dragged && d.sqrMagnitude > DragThresholdPx * DragThresholdPx) dragged = true;
            }
        }

        private Image FindFrameImage()
        {
            Image[] imgs = GetComponentsInChildren<Image>(true);
            for (int i = 0; i < imgs.Length; i++)
                if (imgs[i] != ring && imgs[i] != icon) return imgs[i];
            return null;
        }

        // ============================== TEKAN / LEPAS ============================
        /// <summary>EventSystem -> pointer down. Membuka popup kandidat bila mode aim aktif.</summary>
        public void OnPointerDown(PointerEventData e)
        {
            holding = true; dragged = false; consumed = false; chosenPropId = 0;
            downPos = e.position;
            rt.localScale = Vector3.one * 0.94f;
            Vibrate();
            if (CanAim()) OpenPopup(e.position);
        }

        /// <summary>EventSystem -> pointer up. Pakai skill: propId terpilih (0 = otomatis).</summary>
        public void OnPointerUp(PointerEventData e)
        {
            if (!holding) return;
            holding = false;
            rt.localScale = Vector3.one;
            bool wasConsumed = consumed;
            ClosePopup();
            if (wasConsumed) return;                       // sudah dipakai lewat klik popup

            PlayerController pc = Local();
            if (pc == null) return;
            Fire(pc.Role == GameRole.Seeker ? (byte)0 : (dragged ? chosenPropId : (byte)0));
        }

        /// <summary>Pakai skill slot ini. propId 0 = biarkan game memilih (perilaku lama).</summary>
        public void Fire(byte propId)
        {
            UIManager um = uiManager != null ? uiManager : UIManager.Instance;
            if (um != null) um.UseSkill(slot, propId);
        }

        private static void Vibrate()
        {
            if (!Application.isMobilePlatform) return;
#if UNITY_ANDROID || UNITY_IOS
            Handheld.Vibrate();
#endif
        }

        // ================================ POPUP AIM ==============================
        /// <summary>Mode aim hanya untuk Hider, slot 1, saat cooldown Prop siap & ada >1 kandidat.</summary>
        private bool CanAim()
        {
            if (!propAimMode || slot != 1) return false;
            PlayerController pc = Local();
            if (pc == null || pc.Role != GameRole.Hider || pc.IsGhost) return false;
            HiderSkill hs = pc.HiderSkills;
            if (hs == null || !hs.IsReady) return false;
            List<PropDatabase.PropEntry> probe = hs.GetPropChoices(2);
            return probe != null && probe.Count > 1;              // minimal 2 kandidat -> aim berguna
        }

        /// <summary>Bangun popup kandidat wujud (dari PropDatabase) di sekitar tombol.</summary>
        private void OpenPopup(Vector2 screenPos)
        {
            PlayerController pc = Local();
            HiderSkill hs = pc != null ? pc.HiderSkills : null;
            if (hs == null) return;
            List<PropDatabase.PropEntry> choices = hs.GetPropChoices(Mathf.Max(2, maxChoices));
            if (choices == null || choices.Count == 0) return;

            EnsurePopupRoot();
            for (int i = 0; i < popupKids.Count; i++) if (popupKids[i] != null) Destroy(popupKids[i]);
            popupKids.Clear();

            for (int i = 0; i < choices.Count; i++)
            {
                GameObject go = MakeChoiceItem(choices[i]);
                if (go == null) continue;
                go.name = "prop_" + choices[i].id;
                popupKids.Add(go);
            }
            if (popupRoot != null) popupRoot.gameObject.SetActive(true);
        }

        /// <summary>Satu item popup: prefab bila disediakan, kalau tidak dibuat sederhana (Image+Text+Button).</summary>
        private GameObject MakeChoiceItem(PropDatabase.PropEntry entry)
        {
            GameObject go = popupItem != null
                ? (GameObject)Instantiate(popupItem, popupRoot)
                : BuildSimpleItem();
            if (go == null) return null;

            Text t = go.GetComponentInChildren<Text>(true);
            if (t != null) t.text = entry.displayName;

            Image im = go.GetComponentInChildren<Image>(true);
            Sprite sp = SpriteOf(entry);
            if (im != null && sp != null) { im.sprite = sp; im.color = Color.white; }

            Button b = go.GetComponentInChildren<Button>(true);
            if (b != null)
            {
                byte id = entry.id;
                b.onClick.RemoveAllListeners();
                b.onClick.AddListener(delegate { Choose(id); });
            }
            return go;
        }

        private GameObject BuildSimpleItem()
        {
            var go = new GameObject("choice", typeof(RectTransform), typeof(Image), typeof(Button), typeof(LayoutElement));
            go.transform.SetParent(popupRoot, false);

            var le = go.GetComponent<LayoutElement>();
            le.minWidth = 96f; le.minHeight = HudV2Theme.MinTouch;

            var img = go.GetComponent<Image>();
            img.color = HudV2Theme.WithAlpha(HudV2Theme.Glass, 0.94f);

            var tGo = new GameObject("t", typeof(RectTransform), typeof(Text));
            tGo.transform.SetParent(go.transform, false);
            var tr = (RectTransform)tGo.transform;
            tr.anchorMin = Vector2.zero; tr.anchorMax = Vector2.one;
            tr.offsetMin = new Vector2(6f, 2f); tr.offsetMax = new Vector2(-6f, -2f);
            var txt = tGo.GetComponent<Text>();
            txt.font = HudV2Theme.DefaultFont; txt.fontSize = 13;
            txt.alignment = TextAnchor.MiddleCenter; txt.color = HudV2Theme.Ink;

            go.AddComponent<Outline>().effectColor = HudV2Theme.GlassEdge;
            go.AddComponent<Outline>().effectDistance = new Vector2(1f, -1f);
            return go;
        }

        /// <summary>Popup dibuat di parent tombol (bawah tombol, sejajar) bila belum di-assign.</summary>
        private void EnsurePopupRoot()
        {
            if (popupRoot != null) return;
            var holder = new GameObject("skillChoices", typeof(RectTransform), typeof(HorizontalLayoutGroup)).GetComponent<RectTransform>();
            holder.SetParent(rt != null ? rt.parent : transform, false);
            holder.anchorMin = new Vector2(0f, 1f);
            holder.anchorMax = new Vector2(1f, 1f);
            holder.pivot = new Vector2(0.5f, 1f);
            holder.anchoredPosition = new Vector2(0f, -6f);
            holder.sizeDelta = new Vector2(0f, 52f);
            var lg = holder.GetComponent<HorizontalLayoutGroup>();
            lg.spacing = 6f; lg.padding = new RectOffset(6, 6, 4, 4);
            lg.childAlignment = TextAnchor.MiddleCenter; lg.childForceExpandWidth = false;
            popupRoot = holder;
        }

        /// <summary>Item popup dipilih -> pakai skill dengan propId itu (satu kali, tanpa dobel).</summary>
        private void Choose(byte propId)
        {
            chosenPropId = propId;
            consumed = true;
            ClosePopup();
            Fire(propId);
        }

        private void ClosePopup()
        {
            for (int i = 0; i < popupKids.Count; i++)
                if (popupKids[i] != null) Destroy(popupKids[i]);
            popupKids.Clear();
            if (popupRoot != null) popupRoot.gameObject.SetActive(false);
        }

        private static Sprite SpriteOf(PropDatabase.PropEntry entry)
        {
            if (entry == null) return null;
            GameObject pf = entry.ResolvePrefab();
            if (pf == null) return null;
            SpriteRenderer sr = pf.GetComponentInChildren<SpriteRenderer>(true);
            return sr != null ? sr.sprite : null;
        }

        // ============================== REFRESH / FRAME =========================
        /// <summary>Slot Bekukan hanya untuk Hider; ikon slot 0/1 ditukar sesuai role (parity web).</summary>
        private void RefreshRoleVisibility(PlayerController pc)
        {
            if (pc == null) return;
            bool seeker = pc.Role == GameRole.Seeker;
            if (slot == 2 && button != null && button.gameObject != null && button.gameObject.activeSelf == seeker)
                button.gameObject.SetActive(!seeker);

            if (icon != null && seekerIcon != null && hiderIcon != null)
            {
                Sprite want = seeker ? seekerIcon : hiderIcon;
                if (icon.sprite != want) icon.sprite = want;
            }
        }

        /// <summary>Isi ring cooldown + label + interactable memakai data skill lokal.</summary>
        private void RefreshCooldown(PlayerController pc)
        {
            if (pc == null) return;
            float remain = 0f, total = 1f;
            bool usable = !pc.IsGhost;

            if (pc.Role == GameRole.Seeker)
            {
                SeekerSkill ss = pc.SeekerSkills;
                if (ss == null || slot == 2) usable = false;
                else { remain = ss.CooldownRemaining; total = Mathf.Max(0.01f, ss.cooldown); }
            }
            else
            {
                HiderSkill hs = pc.HiderSkills;
                if (hs == null) usable = false;
                else if (slot == 2) { remain = hs.FreezeCooldownRemaining; total = Mathf.Max(0.01f, HideSeekConstants.FreezeCooldown); }
                else { remain = hs.CooldownRemaining; total = Mathf.Max(0.01f, hs.cooldown); }
            }

            if (ring != null) ring.fillAmount = remain <= 0f ? 0f : Mathf.Clamp01(remain / total);
            if (label != null)
            {
                label.text = remain > 0.05f ? Mathf.CeilToInt(remain).ToString() : ShortKey(pc);
                label.color = remain > 0.05f ? HudV2Theme.Ink : HudV2Theme.WithAlpha(HudV2Theme.Ink, 0.82f);
            }
            if (button != null) button.interactable = usable && remain <= 0f;
            if (frame != null)
            {
                Color c = frame.color;
                float a = usable && remain <= 0f ? 1f : 0.55f;
                if (!Mathf.Approximately(c.a, a)) { c.a = a; frame.color = c; }
            }
        }

        /// <summary>Huruf singkat saat tombol siap (sama seperti HUD web): C/P/F, R/B utk Seeker.</summary>
        private string ShortKey(PlayerController pc)
        {
            bool seeker = pc != null && pc.Role == GameRole.Seeker;
            if (slot == 0) return seeker ? "R" : "C";
            if (slot == 1) return seeker ? "B" : "P";
            return "F";
        }

        // ================================ HELPERS ==============================
        /// <summary>PlayerController milik pemain lokal (lewat UIManager, fallback ke registry).</summary>
        private PlayerController Local()
        {
            if (uiManager == null) uiManager = UIManager.Instance;
            if (uiManager != null && uiManager.LocalController != null) return uiManager.LocalController;
            return PhotonNetwork.LocalPlayer != null ? PlayerRegistry.Get(PhotonNetwork.LocalPlayer.ActorNumber) : null;
        }
    }
}
