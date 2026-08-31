Prefab players & props (diisi manual atau oleh menu HideSeek > Setup).

- PlayerNetworked.prefab  : root = Rigidbody2D + BoxCollider2D + PhotonView + script pemain;
  child "Visual" = SpriteRenderer. PhotonView.observed = [PlayerController, PlayerCombat].
- Props/Prop_Table.prefab / Prop_Chair.prefab / Prop_FlowerPot.prefab :
  SpriteRenderer + BoxCollider2D di layer Ground. Referensinya disimpan di PropDatabase.asset.

Salinan prefab juga disimpan di Assets/Resources/HideSeek/ sebagai fallback otomatis.
