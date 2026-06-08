import { AddressState } from '@ambire-common/interfaces/domains'

export type RailgunSyncStatus = 'idle' | 'running' | 'ready' | 'error'

export type RailgunBalance = {
  tokenAddress: string
  amount: string
}

export type RailgunReactState = {
  status: RailgunSyncStatus
  error?: string
  balances: RailgunBalance[]
  chainId: number
}

type ValidationFormMsgs = {
  amount: { success: boolean; message: string }
  recipientAddress: { success: boolean; message: string }
}

// What screens can push into the local railgun form state.
export type RailgunFormUpdate = {
  selectedToken?: any
  depositAmount?: string
  withdrawalAmount?: string
  addressState?: Partial<AddressState>
  amountFieldMode?: 'token' | 'fiat'
  amountInFiat?: string
  maxAmount?: string
  isRecipientAddressUnknown?: boolean
  isRecipientAddressUnknownAgreed?: boolean
  withdrawAsWETH?: boolean
  privacyProvider?: string
}

// A railgun asset amount, matching the SDK plugin shape ({ __type:'erc20' }).
export type RailgunAssetAmount = {
  asset: { __type: 'erc20'; contract: `0x${string}` }
  amount: bigint
}

// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for the Railgun UI. SDK-owned fields come from the
// `railgunV2` background controller; form fields are local React state. There is
// NO dependency on the legacy `railgun` controller.
// ─────────────────────────────────────────────────────────────────────────────
export type EnhancedRailgunControllerState = {
  // ── local form state ──
  selectedToken: any
  depositAmount: string
  withdrawalAmount: string
  addressState: AddressState
  amountFieldMode: 'token' | 'fiat'
  amountInFiat: string
  maxAmount: string
  isRecipientAddressUnknown: boolean
  isRecipientAddressUnknownAgreed: boolean
  programmaticUpdateCounter: number
  withdrawAsWETH: boolean
  privacyProvider: string
  chainId: number
  validationFormMsgs: ValidationFormMsgs
  latestBroadcastedToken: any

  // ── SDK-backed (railgunV2 controller) ──
  railgunAccountsState: RailgunReactState
  zkAddress: string | null
  signAccountOpController: any
  latestBroadcastedAccountOp: any
  hasProceeded: boolean
  isAccountLoaded: boolean
  isLoadingAccount: boolean
  isRefreshing: boolean
  isReadyToLoad: boolean

  // ── actions ──
  update: (u: RailgunFormUpdate) => void
  resetForm: () => void
  setUserProceeded: (proceeded: boolean) => void
  destroyLatestBroadcastedAccountOp: () => void
  loadPrivateAccount: () => Promise<void>
  refreshPrivateAccount: () => Promise<void>
  shield: (asset: RailgunAssetAmount) => void
  unshieldTo: (asset: RailgunAssetAmount, to: `0x${string}`) => void
  transferTo: (asset: RailgunAssetAmount, to: `0zk${string}`) => void
}
