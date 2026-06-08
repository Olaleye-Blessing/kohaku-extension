/* eslint-disable no-console */
import { useCallback, useMemo, useState } from 'react'
import { useModalize } from 'react-native-modalize'
import { formatEther, formatUnits, getAddress } from 'viem'
import { ZERO_ADDRESS } from '@ambire-common/services/socket/constants'
import { PINNED_TOKENS } from '@ambire-common/consts/pinnedTokens'
import useBackgroundService from '@web/hooks/useBackgroundService'
import useRailgunControllerState from '@web/hooks/useRailgunControllerState'
import useSelectedAccountControllerState from '@web/hooks/useSelectedAccountControllerState'

/**
 * Hook for managing Railgun privacy protocol operations
 * Handles deposits, withdrawals, and form state specific to Railgun.
 *
 * All on-chain/SDK work is delegated to the background `railgunV2` controller
 * via dispatched actions — this hook no longer touches the Railgun SDK directly.
 */
const useRailgunForm = () => {
  const { dispatch } = useBackgroundService()
  const {
    chainId,
    validationFormMsgs,
    hasProceeded,
    depositAmount,
    withdrawalAmount,
    signAccountOpController,
    latestBroadcastedAccountOp,
    isAccountLoaded,
    isLoadingAccount,
    isRefreshing,
    isReadyToLoad,
    privacyProvider,
    loadPrivateAccount,
    refreshPrivateAccount,
    railgunAccountsState,
    selectedToken,
    update,
    setUserProceeded,
    shield
  } = useRailgunControllerState()

  const { account: userAccount, portfolio } = useSelectedAccountControllerState()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const ethPrice = chainId
    ? portfolio.tokens
        .find((token) => token.chainId === BigInt(chainId) && token.name === 'Ether')
        ?.priceIn.find((price) => price.baseCurrency === 'usd')?.price
    : undefined

  const totalApprovedBalance = useMemo(() => {
    if (railgunAccountsState.balances.length > 0) {
      let balance = BigInt(0);
      for (const bal of railgunAccountsState.balances) {
        if (bal.tokenAddress === ZERO_ADDRESS) {
          balance += BigInt(bal.amount);
        }
      }
      return { total: balance, accounts: []}
    }
    return { total: 0n, accounts: [] }
  }, [railgunAccountsState])

  const totalPrivateBalancesFormatted = useMemo(() => {
    const railgunBalances = railgunAccountsState.balances;
    const balanceMap: Record<string, { amount: string; decimals: number; symbol: string; name: string; price?: number }> = {};
    
    for (const balance of railgunBalances) {
      const tokenAddressLower = balance.tokenAddress.toLowerCase();
      const currentChainId = BigInt(chainId || 0);
      
      // Try to find a matching token in user's portfolio first
      let token = portfolio.tokens.find(
        (t) => 
          t.chainId === currentChainId && 
          t.address.toLowerCase() === tokenAddressLower
      );

      // If not found, try to find it in pinnedTokens (global pinned list)
      if (!token && typeof window !== 'undefined' && (window as any).pinnedTokens) {
        token = (window as any).pinnedTokens.find(
          (t: any) =>
            t.chainId === currentChainId &&
            t.address.toLowerCase() === tokenAddressLower
        );
      }

      // If still not found, check if it's a pinned token (from PINNED_TOKENS constant)
      // For pinned tokens, we should show them even if not in current portfolio
      const isPinned = PINNED_TOKENS.some(
        (pinned) =>
          pinned.chainId === currentChainId &&
          pinned.address.toLowerCase() === tokenAddressLower
      );

      // If we have token metadata, use it
      if (token) {
        const tokenPrice = token.priceIn?.find((price) => price.baseCurrency === 'usd')?.price;
        balanceMap[tokenAddressLower] = { 
          amount: balance.amount,
          decimals: token.decimals,
          symbol: token.symbol,
          name: token.name,
          price: tokenPrice,
        };
      } else if (isPinned) {
        // For pinned tokens without metadata, use fallback info
        // Common token decimals: USDC/USDT = 6, most others = 18
        const isUSDC = tokenAddressLower === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' || // Mainnet USDC
                       tokenAddressLower === '0x0b2c639c533813f4aa9d7837caf62653d097ff85' || // Optimism USDC
                       tokenAddressLower === '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238'; // Sepolia USDC
        const isNative = tokenAddressLower === ZERO_ADDRESS.toLowerCase();
        
        balanceMap[tokenAddressLower] = {
          amount: balance.amount,
          decimals: isUSDC ? 6 : (isNative ? 18 : 18), // Default to 18, 6 for USDC
          symbol: isNative ? 'ETH' : (isUSDC ? 'USDC' : 'Unknown'),
          name: isNative ? 'Ethereum' : (isUSDC ? 'USD Coin' : 'Unknown Token'),
          price: undefined, // No price available without portfolio data
        };
      }
      // If not found in portfolio, not in window.pinnedTokens, and not pinned, skip it
      // This maintains the current behavior for non-pinned tokens
    }
    
    return balanceMap;
  }, [railgunAccountsState, portfolio.tokens, chainId])

  const totalPendingBalance = useMemo(() => {
    return { total: 0n, accounts: [] }
  }, [])

  const totalDeclinedBalance = useMemo(() => {
    return { total: 0n, accounts: [] }
  }, [])

  const totalPrivatePortfolio = useMemo(() => {
    let totalUsdValue = 0
    
    for (const tokenAddress in totalPrivateBalancesFormatted) {
      const token = totalPrivateBalancesFormatted[tokenAddress]
      if (token.price !== undefined) {
        const tokenAmount = Number(formatUnits(BigInt(token.amount), token.decimals))
        totalUsdValue += tokenAmount * token.price
      }
    }
    
    return totalUsdValue
  }, [totalPrivateBalancesFormatted])

  const ethPrivateBalance = useMemo(() => {
    return formatEther(totalApprovedBalance.total)
  }, [totalApprovedBalance])

  const {
    ref: estimationModalRef,
    open: openEstimationModal,
    close: closeEstimationModal
  } = useModalize()

  const handleUpdateForm = useCallback(
    (params: { [key: string]: any }) => {
      // Railgun form state is local React state now (no legacy controller).
      update(params)

      // If privacyProvider is being updated, sync it to Privacy Pools controller as well
      if (params.privacyProvider !== undefined) {
        dispatch({
          type: 'PRIVACY_POOLS_CONTROLLER_UPDATE_FORM',
          params: { privacyProvider: params.privacyProvider }
        })
      }

      setMessage(null)
    },
    [dispatch, update]
  )

  const openEstimationModalAndDispatch = useCallback(() => {
    setUserProceeded(true)
    openEstimationModal()
  }, [openEstimationModal, setUserProceeded])

  const handleDeposit = async () => {
    console.log('DEBUG: RAILGUN handleDeposit called')
    console.log('DEBUG: Deposit amount:', depositAmount)
    console.log('DEBUG: Chain ID:', chainId)
    console.log('DEBUG: User account:', userAccount?.addr)
    console.log('DEBUG: selectedToken:', selectedToken)
    
    // Validate required fields
    if (!selectedToken) {
      const errorMsg = 'No token selected. Please select a token before depositing.'
      console.error('DEBUG:', errorMsg)
      setMessage({ type: 'error', text: errorMsg })
      return
    }

    if (!selectedToken.address) {
      const errorMsg = 'Selected token is missing address. Please select a valid token.'
      console.error('DEBUG:', errorMsg)
      setMessage({ type: 'error', text: errorMsg })
      return
    }

    if (!depositAmount || depositAmount === '0') {
      const errorMsg = 'Deposit amount is required.'
      console.error('DEBUG:', errorMsg)
      setMessage({ type: 'error', text: errorMsg })
      return
    }

    // Validate decimals are present
    const tokenDecimals = selectedToken.decimals
    if (tokenDecimals === undefined || tokenDecimals === null) {
      const errorMsg = `Token ${selectedToken.symbol || 'unknown'} is missing decimals information. Cannot proceed with deposit.`
      console.error('DEBUG:', errorMsg, selectedToken)
      setMessage({ type: 'error', text: errorMsg })
      return
    }

    // Determine if this is native ETH
    const tokenAddressLower = selectedToken.address.toLowerCase()
    const zeroAddressLower = ZERO_ADDRESS.toLowerCase()
    const isEth = tokenAddressLower === zeroAddressLower
    
    // Sanity check: verify token address matches what we expect
    if (isEth && tokenAddressLower !== zeroAddressLower) {
      const errorMsg = `Token address mismatch: expected ETH (${ZERO_ADDRESS}) but got ${selectedToken.address}. Cannot proceed.`
      console.error('DEBUG:', errorMsg)
      setMessage({ type: 'error', text: errorMsg })
      return
    }

    // Sanity check: ETH should have 18 decimals
    if (isEth && tokenDecimals !== 18) {
      const errorMsg = `Invalid decimals for ETH: expected 18 but got ${tokenDecimals}. This indicates a token configuration error.`
      console.error('DEBUG:', errorMsg)
      setMessage({ type: 'error', text: errorMsg })
      return
    }

    // depositAmount is already in base units (wei/base units), so we just convert to BigInt
    // DO NOT use parseUnits here as it would apply decimals twice
    let depositAmountBigInt: bigint
    try {
      depositAmountBigInt = BigInt(depositAmount)
      console.log('DEBUG: Converted deposit amount to BigInt:', depositAmountBigInt.toString(), '(already in base units, decimals:', tokenDecimals, ')')
    } catch (error: any) {
      const errorMsg = `Failed to convert deposit amount "${depositAmount}" to BigInt: ${error?.message || 'Unknown error'}`
      console.error('DEBUG:', errorMsg, error)
      setMessage({ type: 'error', text: errorMsg })
      return
    }

    // alpha.10 of the railgun SDK only supports shielding ERC20 tokens (the
    // plugin's tokenGuard rejects native assets). Native ETH must be wrapped to
    // WETH first; surface a clear error rather than silently failing.
    if (isEth) {
      const errorMsg =
        'Native ETH shielding is not supported by this SDK version. Please wrap to WETH and shield the ERC20 token instead.'
      console.error('DEBUG:', errorMsg)
      setMessage({ type: 'error', text: errorMsg })
      return
    }

    try {
      // Hand off to the railgunV2 controller: it calls prepareShield(), prepends
      // the ERC20 approval, and routes the resulting calls through its own
      // SignAccountOpController. We then open the estimation modal to drive
      // signing & broadcast (updateType 'RailgunV2').
      shield({
        asset: { __type: 'erc20', contract: getAddress(selectedToken.address) },
        amount: depositAmountBigInt
      })

      openEstimationModalAndDispatch()
      setMessage(null) // Clear any previous errors
    } catch (error: any) {
      const errorMsg = `Failed to create deposit transaction: ${error?.message || 'Unknown error'}`
      console.error('DEBUG: Deposit error:', error)
      setMessage({ type: 'error', text: errorMsg })
    }
  }

  const handleMultipleWithdrawal = useCallback(async () => {
    console.log('RAILGUN WITHDRAWAL: Implementation coming soon')
    console.log('Withdrawal amount:', withdrawalAmount)
    console.log('Chain ID:', chainId)

    // TODO: Implement Railgun withdrawal logic
    // This will involve:
    // 1. Generating Railgun unshield proof
    // 2. Creating the withdrawal transaction
    // 3. Calling syncSignAccountOp with the transaction
    // 4. Opening the estimation modal

    setMessage({ type: 'error', text: 'Railgun withdrawals not yet implemented' })
  }, [chainId, withdrawalAmount])

  // Railgun doesn't have ragequit functionality like Privacy Pools
  const handleMultipleRagequit = useCallback(async () => {
    console.log('Ragequit not applicable for Railgun')
  }, [])

  // Railgun doesn't use pool accounts
  const handleSelectedAccount = () => {
    console.log('Account selection not applicable for Railgun')
  }

  const isRagequitLoading = () => false

  return {
    chainId,
    ethPrice,
    message,
    poolInfo: undefined, // Railgun doesn't have poolInfo
    chainData: undefined,
    seedPhrase: undefined,
    poolAccounts: [], // Railgun doesn't have pool accounts
    hasProceeded,
    depositAmount,
    accountService: undefined,
    withdrawalAmount,
    privacyProvider,
    selectedToken,
    showAddedToBatch: false,
    estimationModalRef,
    selectedPoolAccount: null,
    signAccountOpController,
    latestBroadcastedAccountOp,
    isLoading: isLoadingAccount,
    isRefreshing,
    isAccountLoaded,
    totalApprovedBalance,
    totalPrivateBalancesFormatted,
    totalPendingBalance,
    totalDeclinedBalance,
    totalPrivatePortfolio,
    ethPrivateBalance,
    isReadyToLoad,
    isReady: true,
    validationFormMsgs,
    handleDeposit,
    handleMultipleRagequit,
    handleMultipleWithdrawal,
    handleUpdateForm,
    isRagequitLoading,
    closeEstimationModal,
    handleSelectedAccount,
    loadPrivateAccount,
    refreshPrivateAccount,
    openEstimationModalAndDispatch
  }
}

export default useRailgunForm
