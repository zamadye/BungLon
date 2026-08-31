Folder prefab untuk kebutuhan tim/artis. Menu HideSeek > Setup menulis/menyalin ke sini.

- PlayerNetworked.prefab  : root = Rigidbody2D + BoxCollider2D (solid) + BoxCollider2D (trigger 1.15)
                            + PhotonView + PlayerController, PlayerCombat, HiderSkill, SeekerSkill,
                            CamouflageHelper, PlayerVisual. Child "Visual" = SpriteRenderer.
                            PhotonView.Observed = [PlayerController, PlayerCombat]  <- tanpa ini tidak sync.
                            Ini SALINAN saja; yang dipakai jaringan adalah Assets/Resources/PlayerNetworked.prefab
                            (Photon hanya membaca root folder Resources - bukan sub-folder!).
                            Assign file di folder ini ke NetworkManager.playerPrefab, atau biarkan kosong
                            (otomatis diambil dari Resources).
- Props/Prop_Table.prefab / Prop_Chair.prefab / Prop_FlowerPot.prefab :
  SpriteRenderer + BoxCollider2D di layer Ground. Referensinya disimpan di PropDatabase.asset
  (Create > HideSeek > Prop Database). id prop 0/1/2 tidak boleh berubah antar build.
- SonicBlastRing.prefab, MapPlaceholder.prefab : dibuat otomatis oleh Setup > 1.

Body Type Rigidbody2D: Dynamic (velocity) ATAU Kinematic (MovePosition) - keduanya didukung
PlayerController. Gravity Scale = 0 dan Freeze Rotation Z dipaksa juga di Awake(), jadi lupa
setel di prefab tidak bikin karakter jatuh.
