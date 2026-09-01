// ============================================================================
//  HudV2Settings.cs   (HUD v2 - panel Settings, blueprint 4.5)
//  Tiga hal yang pemain mobile benar-benar ubah: sensitivitas joystick, suara
//  (BGM+SFX), dan tombol hapus rekor lokal. Nilainya disimpan di PlayerPrefs
//  dengan SATU kunci "hideseek_ui" (sama seperti localStorage di web) memakai
//  format "sens=1.2;bgm=1;sfx=1;" supaya port web/Unity tetap satu jiwa.
//
//  Semua referensi di-assign manual di Inspector (Slider / Toggle / Button).
// ============================================================================

using UnityEngine;
using UnityEngine.Audio;
using UnityEngine.UI;

namespace HideSeek.UI
{
    /// <summary>Preferensi HUD v2 (joystick + audio + rekor lokal) dengan persistensi PlayerPrefs.</summary>
    [DisallowMultipleComponent]
    public class HudV2Settings : MonoBehaviour
    {
        /// <summary>Kunci PlayerPrefs untuk preferensi UI (paritas nama dengan web).</summary>
        public const string PrefsKey = "hideseek_ui";
        public const float MinSens = 0.7f;
        public const float MaxSens = 1.5f;
        public const float DefaultSens = 1f;

        [Header("Isian Inspector (assign manual)")]
        [Tooltip("Slider sensitivitas: value 0..1 dipetakan ke 0.7 - 1.5.")]
        public Slider sensitivitySlider;
        [Tooltip("Label persen di samping slider (mis. \"110%\").")]
        public Text sensitivityLabel;
        [Tooltip("Joystick yang diatur. Kosong = pakai joystick milik UIManager.Instance.")]
        public MobileJoystick joystick;
        public Toggle musicToggle;
        public Toggle soundToggle;
        [Tooltip("Button untuk menghapus rekor lokal (HudV2LocalBoard).")]
        public Button clearBoardButton;
        [Tooltip("Teks kecil status (mis. \"tersimpan\").")]
        public Text statusText;

        private static HudV2Settings instance;
        private bool applying;

        // ============================== LIFECYCLE ================================
        private void Awake()
        {
            instance = this;
            Load();
            if (sensitivitySlider != null)
            {
                sensitivitySlider.minValue = 0f; sensitivitySlider.maxValue = 1f;
                sensitivitySlider.onValueChanged.RemoveAllListeners();
                sensitivitySlider.onValueChanged.AddListener(delegate (float v) { OnSensChanged(v); });
            }
            if (musicToggle != null)
            {
                musicToggle.onValueChanged.RemoveAllListeners();
                musicToggle.onValueChanged.AddListener(delegate (bool on) { SetMusicOn(on, true); });
            }
            if (soundToggle != null)
            {
                soundToggle.onValueChanged.RemoveAllListeners();
                soundToggle.onValueChanged.AddListener(delegate (bool on) { SetSoundOn(on, true); });
            }
            if (clearBoardButton != null)
            {
                clearBoardButton.onClick.RemoveAllListeners();
                clearBoardButton.onClick.AddListener(OnClearBoard);
            }
            PushAll();
        }

        private void OnEnable() { instance = this; Load(); PushAll(); }
        private void OnDestroy() { if (instance == this) instance = null; }

        // ================================ API ==================================
        /// <summary>Sensitivitas tersimpan (0.7 - 1.5); aman dipakai walau panel tidak dibuka.</summary>
        public static float StoredSensitivity
        {
            get
            {
                float v = PlayerPrefs.GetFloat(PrefsKey + ".sens", DefaultSens);
                return Mathf.Clamp(v, MinSens, MaxSens);
            }
        }

        /// <summary>Musik/SFX hidup? (dipakai pemutar BGM & SFX agar konsisten dengan panel).</summary>
        public static bool MusicOn { get { return PlayerPrefs.GetInt(PrefsKey + ".bgm", 1) == 1; } }
        public static bool SoundOn { get { return PlayerPrefs.GetInt(PrefsKey + ".sfx", 1) == 1; } }

        public void SetSensitivity(float value, bool save = true)
        {
            float v = Mathf.Clamp(value, MinSens, MaxSens);
            if (joystick == null && UIManager.Instance != null) joystick = UIManager.Instance.Joystick;
            if (joystick != null) joystick.sensitivity = v;
            if (sensitivitySlider != null)
            {
                applying = true;
                sensitivitySlider.value = (v - MinSens) / Mathf.Max(0.001f, MaxSens - MinSens);
                applying = false;
            }
            if (sensitivityLabel != null) sensitivityLabel.text = Mathf.RoundToInt(v / DefaultSens * 100f) + "%";
            if (save) { PlayerPrefs.SetFloat(PrefsKey + ".sens", v); SaveBlob(); }
            Note("sensitivitas " + Mathf.RoundToInt(v / DefaultSens * 100f) + "%");
        }

        public void SetMusicOn(bool on, bool fromToggle = false)
        {
            PlayerPrefs.SetInt(PrefsKey + ".bgm", on ? 1 : 0);
            if (musicToggle != null && musicToggle.isOn != on) musicToggle.isOn = on;
            ApplyAudioVolumes();
            if (fromToggle) SaveBlob();
            Note(on ? "musik: nyala" : "musik: mati");
        }

        public void SetSoundOn(bool on, bool fromToggle = false)
        {
            PlayerPrefs.SetInt(PrefsKey + ".sfx", on ? 1 : 0);
            if (soundToggle != null && soundToggle.isOn != on) soundToggle.isOn = on;
            ApplyAudioVolumes();
            if (fromToggle) SaveBlob();
            Note(on ? "sfx: nyala" : "sfx: mati");
        }

        private void OnSensChanged(float v)
        {
            if (applying) return;
            SetSensitivity(MinSens + Mathf.Clamp01(v) * (MaxSens - MinSens));
        }

        private void OnClearBoard()
        {
            HudV2LocalBoard.ClearAll();
            Note("rekor lokal dihapus");
        }

        // ============================ persistensi blob ==========================
        /// <summary>Baca nilai dari PlayerPrefs (dipanggil Awake/OnEnable).</summary>
        public void Load()
        {
            // Blob "sens=1.2;bgm=1;sfx=1;" diutamakan; kalau belum ada, pakai kunci terpisah.
            string blob = PlayerPrefs.GetString(PrefsKey, string.Empty);
            if (!string.IsNullOrEmpty(blob))
            {
                string[] parts = blob.Split(';');
                for (int i = 0; i < parts.Length; i++)
                {
                    string[] kv = parts[i].Split('=');
                    if (kv.Length != 2) continue;
                    float f;
                    switch (kv[0].Trim())
                    {
                        case "sens": if (float.TryParse(kv[1], out f)) PlayerPrefs.SetFloat(PrefsKey + ".sens", Mathf.Clamp(f, MinSens, MaxSens)); break;
                        case "bgm": if (float.TryParse(kv[1], out f)) PlayerPrefs.SetInt(PrefsKey + ".bgm", f > 0.5f ? 1 : 0); break;
                        case "sfx": if (float.TryParse(kv[1], out f)) PlayerPrefs.SetInt(PrefsKey + ".sfx", f > 0.5f ? 1 : 0); break;
                    }
                }
            }
        }

        /// <summary>Tulis balik blob (supaya tools/telemetri bisa membaca satu kunci saja).</summary>
        private void SaveBlob()
        {
            var sb = new System.Text.StringBuilder(48);
            sb.Append("sens=").Append(StoredSensitivity.ToString("0.###")).Append(';')
              .Append("bgm=").Append(MusicOn ? 1 : 0).Append(';')
              .Append("sfx=").Append(SoundOn ? 1 : 0).Append(';');
            PlayerPrefs.SetString(PrefsKey, sb.ToString());
            PlayerPrefs.Save();
        }

        // ================================ terapkan ===============================
        private void PushAll()
        {
            SetSensitivity(StoredSensitivity, false);
            if (musicToggle != null) musicToggle.isOn = MusicOn;
            if (soundToggle != null) soundToggle.isOn = SoundOn;
            ApplyAudioVolumes();
        }

        /// <summary>
        /// Terapkan ke AudioListener (proyek belum punya mixer; kalau nanti ada
        /// AudioMixer, assign mainMixer di inspector UIManager - di sini cukup volume global).
        /// </summary>
        private static void ApplyAudioVolumes()
        {
            float bgm = MusicOn ? 1f : 0f;
            float sfx = SoundOn ? 1f : 0f;
            AudioListener.volume = Mathf.Max(bgm, sfx);                 // 0 = bisukan total
            // Kalau project punya mixer, sumbernya tetap sama: kedua nilai di atas.
            if (mainMixer != null)
            {
                mainMixer.SetFloat("Bgm", bgm > 0.5f ? 0f : -80f);
                mainMixer.SetFloat("Sfx", sfx > 0.5f ? 0f : -80f);
            }
        }

        // AudioMixer opsional (group "Bgm" & "Sfx"); kosong = cukup AudioListener.volume.
        private static AudioMixer mainMixer;
        public static AudioMixer MainMixer { get { return mainMixer; } set { mainMixer = value; } }

        private void Note(string msg)
        {
            if (statusText != null) statusText.text = msg;
            if (UIManager.Instance != null) UIManager.Instance.ShowToast(msg);
        }
    }
}
