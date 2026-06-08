import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react'

import { isValidAddress } from '@ambire-common/services/address'
import useBackgroundService from '@web/hooks/useBackgroundService'
import useControllerState from '@web/hooks/useControllerState'
import useDeepMemo from '@common/hooks/useDeepMemo'
import useSelectedAccountControllerState from '@web/hooks/useSelectedAccountControllerState'

import {
  EnhancedRailgunControllerState,
  RailgunAssetAmount,
  RailgunBalance,
  RailgunFormUpdate,
  RailgunReactState
} from './types'
import { DEFAULT_CHAIN_ID } from './constants'

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT
//
// The single source of truth for the Railgun UI, built entirely on the new
// host-interface SDK:
//   • SDK state (balances, zkAddress, sync, sign-op, broadcast) is mirrored from
//     the background `railgunV2` controller.
//   • Form state (selected token, amounts, recipient) is plain local React state.
//
// There is no dependency on the legacy `railgun` controller or any in-browser
// indexing. Operations follow the SDK test files: instantiate (init) → balance
// (sync) → prepareShield / prepareUnshield / prepareTransfer → broadcast.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_ADDRESS_STATE = {
  fieldValue: '',
  ensAddress: '',
  isDomainResolving: false
}

const EMPTY_VALIDATION = {
  amount: { success: false, message: '' },
  recipientAddress: { success: false, message: '' }
}

type RailgunFormState = {
  selectedToken: any
  depositAmount: string
  withdrawalAmount: string
  addressState: typeof DEFAULT_ADDRESS_STATE
  amountFieldMode: 'token' | 'fiat'
  amountInFiat: string
  maxAmount: string
  isRecipientAddressUnknown: boolean
  isRecipientAddressUnknownAgreed: boolean
  withdrawAsWETH: boolean
  privacyProvider: string
  programmaticUpdateCounter: number
  latestBroadcastedToken: any
}

const DEFAULT_FORM_STATE: RailgunFormState = {
  selectedToken: null,
  depositAmount: '',
  withdrawalAmount: '',
  addressState: { ...DEFAULT_ADDRESS_STATE },
  amountFieldMode: 'token',
  amountInFiat: '',
  maxAmount: '',
  isRecipientAddressUnknown: false,
  isRecipientAddressUnknownAgreed: false,
  withdrawAsWETH: false,
  privacyProvider: 'railgun',
  programmaticUpdateCounter: 0,
  latestBroadcastedToken: null
}

const RailgunControllerStateContext = createContext<EnhancedRailgunControllerState>(
  {} as EnhancedRailgunControllerState
)

const RailgunControllerStateProvider: React.FC<any> = ({ children }) => {
  const { dispatch } = useBackgroundService()
  const { account: selectedAccount } = useSelectedAccountControllerState()

  const keystoreState = useControllerState('keystore')
  const isUnlocked = !!keystoreState?.isUnlocked

  // SDK-backed controller state (balance, syncState, zkAddress, sign-op, …)
  const v2State = useControllerState('railgunV2')
  const memoizedV2State = useDeepMemo(v2State, 'railgunV2')

  // Local, React-only form state.
  const [form, setForm] = useState<RailgunFormState>(DEFAULT_FORM_STATE)

  const chainId = DEFAULT_CHAIN_ID

  useEffect(() => {
    if (!Object.keys(v2State).length)
      dispatch?.({ type: 'INIT_CONTROLLER_STATE', params: { controller: 'railgunV2' } })
  }, [dispatch, v2State])

  // Map the SDK balances ({ asset:{__type,contract}, amount:bigint }) into the
  // simple { tokenAddress, amount } view-model the screens expect.
  const balances = useMemo<RailgunBalance[]>(() => {
    const raw = memoizedV2State?.balance ?? []
    return raw.map((b: any) => ({
      tokenAddress: b.asset?.contract ?? '',
      amount: (b.amount ?? 0n).toString()
    }))
  }, [memoizedV2State])

  const railgunAccountsState = useMemo<RailgunReactState>(() => {
    const syncState = memoizedV2State?.syncState ?? 'unsynced'
    const status =
      // eslint-disable-next-line no-nested-ternary
      syncState === 'syncing' ? 'running' : syncState === 'synced' ? 'ready' : 'idle'

    return {
      status,
      error: memoizedV2State?.initializationError ?? undefined,
      balances,
      chainId
    }
  }, [memoizedV2State, balances, chainId])

  const validationFormMsgs = useMemo(() => {
    const msgs = {
      amount: { ...EMPTY_VALIDATION.amount },
      recipientAddress: { ...EMPTY_VALIDATION.recipientAddress }
    }

    if (form.depositAmount && Number(form.depositAmount) > 0) {
      msgs.amount = { success: true, message: '' }
    }

    const recipient = form.addressState.ensAddress || form.addressState.fieldValue
    if (recipient) {
      const isRailgunAddress = recipient.toLowerCase().startsWith('0zk')
      msgs.recipientAddress =
        isRailgunAddress || isValidAddress(recipient)
          ? { success: true, message: '' }
          : { success: false, message: 'Invalid address format' }
    }

    return msgs
  }, [form.depositAmount, form.addressState])

  // ── form actions ──
  const update = useCallback((u: RailgunFormUpdate) => {
    setForm((prev) => {
      const next: RailgunFormState = { ...prev }
      if (u.selectedToken !== undefined) next.selectedToken = u.selectedToken
      if (typeof u.depositAmount === 'string') next.depositAmount = u.depositAmount
      if (typeof u.withdrawalAmount === 'string') next.withdrawalAmount = u.withdrawalAmount
      if (u.addressState) next.addressState = { ...prev.addressState, ...u.addressState }
      if (u.amountFieldMode) next.amountFieldMode = u.amountFieldMode
      if (typeof u.amountInFiat === 'string') next.amountInFiat = u.amountInFiat
      if (typeof u.maxAmount === 'string') next.maxAmount = u.maxAmount
      if (typeof u.isRecipientAddressUnknown === 'boolean')
        next.isRecipientAddressUnknown = u.isRecipientAddressUnknown
      if (typeof u.isRecipientAddressUnknownAgreed === 'boolean')
        next.isRecipientAddressUnknownAgreed = u.isRecipientAddressUnknownAgreed
      if (typeof u.withdrawAsWETH === 'boolean') next.withdrawAsWETH = u.withdrawAsWETH
      if (typeof u.privacyProvider === 'string') next.privacyProvider = u.privacyProvider
      return next
    })
  }, [])

  const resetForm = useCallback(() => setForm(DEFAULT_FORM_STATE), [])

  // ── SDK actions (dispatch to the railgunV2 background controller) ──
  const loadPrivateAccount = useCallback(async () => {
    if (!isUnlocked || !selectedAccount || !dispatch) return
    dispatch({ type: 'RAILGUN_V2_CONTROLLER_INIT' })
    dispatch({ type: 'RAILGUN_V2_CONTROLLER_SYNC' })
  }, [dispatch, isUnlocked, selectedAccount])

  const refreshPrivateAccount = useCallback(async () => {
    if (!dispatch) return
    dispatch({ type: 'RAILGUN_V2_CONTROLLER_SYNC' })
  }, [dispatch])

  const shield = useCallback(
    (asset: RailgunAssetAmount) => {
      dispatch({ type: 'RAILGUN_V2_CONTROLLER_SHIELD', params: { asset } })
    },
    [dispatch]
  )

  const unshieldTo = useCallback(
    (asset: RailgunAssetAmount, to: `0x${string}`) => {
      dispatch({ type: 'RAILGUN_V2_CONTROLLER_UNSHIELD_TO', params: { asset, to } })
    },
    [dispatch]
  )

  const transferTo = useCallback(
    (asset: RailgunAssetAmount, to: `0zk${string}`) => {
      dispatch({ type: 'RAILGUN_V2_CONTROLLER_TRANSFER_TO', params: { asset, to } })
    },
    [dispatch]
  )

  const setUserProceeded = useCallback(
    (proceeded: boolean) => {
      dispatch({ type: 'RAILGUN_V2_CONTROLLER_HAS_USER_PROCEEDED', params: { proceeded } })
    },
    [dispatch]
  )

  const destroyLatestBroadcastedAccountOp = useCallback(() => {
    dispatch({ type: 'RAILGUN_V2_CONTROLLER_DESTROY_LATEST_BROADCASTED_ACCOUNT_OP' })
  }, [dispatch])

  // Auto-sync once the account is available & unlocked.
  useEffect(() => {
    if (!isUnlocked || !selectedAccount) return
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    loadPrivateAccount()
  }, [isUnlocked, selectedAccount, loadPrivateAccount])

  console.log('__ railgunAccountsState __', railgunAccountsState)

  const value: EnhancedRailgunControllerState = useMemo(() => {
    const status = railgunAccountsState.status

    return {
      // local form state
      selectedToken: form.selectedToken,
      depositAmount: form.depositAmount,
      withdrawalAmount: form.withdrawalAmount,
      addressState: form.addressState,
      amountFieldMode: form.amountFieldMode,
      amountInFiat: form.amountInFiat,
      maxAmount: form.maxAmount,
      isRecipientAddressUnknown: form.isRecipientAddressUnknown,
      isRecipientAddressUnknownAgreed: form.isRecipientAddressUnknownAgreed,
      programmaticUpdateCounter: form.programmaticUpdateCounter,
      withdrawAsWETH: form.withdrawAsWETH,
      privacyProvider: form.privacyProvider,
      chainId,
      validationFormMsgs,
      latestBroadcastedToken: form.latestBroadcastedToken,

      // SDK-backed
      railgunAccountsState,
      zkAddress: memoizedV2State?.zkAddress ?? null,
      signAccountOpController: memoizedV2State?.signAccountOpController ?? null,
      latestBroadcastedAccountOp: memoizedV2State?.latestBroadcastedAccountOp ?? null,
      hasProceeded: memoizedV2State?.hasProceeded ?? false,
      isAccountLoaded: status === 'ready',
      isLoadingAccount: status === 'running',
      isRefreshing: status === 'running',
      isReadyToLoad: status === 'ready',

      // actions
      update,
      resetForm,
      setUserProceeded,
      destroyLatestBroadcastedAccountOp,
      loadPrivateAccount,
      refreshPrivateAccount,
      shield,
      unshieldTo,
      transferTo
    }
  }, [
    form,
    chainId,
    validationFormMsgs,
    railgunAccountsState,
    memoizedV2State,
    update,
    resetForm,
    setUserProceeded,
    destroyLatestBroadcastedAccountOp,
    loadPrivateAccount,
    refreshPrivateAccount,
    shield,
    unshieldTo,
    transferTo
  ])

  return (
    <RailgunControllerStateContext.Provider value={value}>
      {children}
    </RailgunControllerStateContext.Provider>
  )
}

export { RailgunControllerStateProvider, RailgunControllerStateContext }
