"use client";

import { ActivityIcon, SettingsIcon, SlidersHorizontalIcon, WalletIcon } from "lucide-react";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import { ADDRESS_SYMBOLS, cn, getBigNumber, getPrice } from "@/lib/utils";
import { ChangeIcon } from "./ui/change-icon";
import { useState, useEffect, useMemo, Suspense } from "react";
import { getQuoteSubscription } from "@/lib/getQuoteSubscription";
import { Avatar, AvatarImage, AvatarFallback } from "@radix-ui/react-avatar";
import { BigNumber } from "bignumber.js";
import { CommandSearch } from "./command-search";
import { SubscribeData } from "./ui/trades-chart";
import { CoinAvatar } from "./CoinAvatar";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { usePathname, useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction } from "@solana/web3.js";
import { toast } from "sonner";
import { useTradingWallet } from "@/hooks/use-trading-wallet";
import { Coin } from "@/lib/types";

const getBalances = async (walletAddress: string) => {
  if (!walletAddress) {
    return;
  }
  const res = await fetch(`https://ultra-api.jup.ag/balances/${walletAddress}`)
  const data = await res.json();
  data['So11111111111111111111111111111111111111112'] = data['SOL'];
  return data;
}

export function Swap() {
  const { publicKey: _publicKey, signTransaction } = useWallet();
  const { getWallet } = useTradingWallet();
  const publicKey = getWallet()?.publicKey || _publicKey;
  const path = usePathname()
  const [symbol, setSymbol] = useState<string>();
  const [markets, setMarkets] = useState<Record<string, SubscribeData>>({});
  const [exchange, setExchange] = useState<string>();
  const { subscribe } = getQuoteSubscription(symbol || path.replace('/', ''));
  const [fromAmount, setFromAmount] = useState<number>();
  const [toAmount, setToAmount] = useState<number>();
  const query = useSearchParams();
  const [balances, setBalances] = useState<Record<string, { uiAmount: number }>>({});
  const [dexExchange, setDexExchange] = useState<string | null>()
  const [fromAddress, setFromAddress] = useState<string | null>('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')
  const [toAddress, setToAddress] = useState<string | null>(localStorage.getItem('dexAddress'));
  const [fromSymbol, setFromSymbol] = useState<string | null>(ADDRESS_SYMBOLS[fromAddress!] || symbol!)
  const [toSymbol, setToSymbol] = useState<string | null>(ADDRESS_SYMBOLS[toAddress!] || symbol!);
  const [swapTxn, setSwapTxn] = useState<string>();
  const [requestId, setRequestId] = useState<string>();
  const fromBalance = useMemo(() => balances[fromAddress!]?.uiAmount || 0, [fromAddress, balances]);
  const toBalance = useMemo(() => balances[toAddress!]?.uiAmount || 0, [toAddress, balances]);
  const debouncedFromAmount = useDebouncedValue(fromAmount!, 150)

  useEffect(() => {
    const unsubscribe = subscribe((data) => {
      if ('coins' in data) {
        const coin = (data.coins as Coin[]).sort((a, b) => b.liquidity - a.liquidity)[0];
        setSymbol((prev) => !prev ? coin.symbol : prev)
        setToAddress((prev) => !prev ? coin.address : prev)
        setDexExchange((prev) => !prev ? coin.exchange : prev)
        return;
      }
      if (!data.price) {
        return;
      }

      if (data.exchange === exchange && exchange && fromAmount) {
        setToAmount(new BigNumber(fromAmount).div(data.price).toNumber())
      }
      setMarkets((prev) => {
        return {
          ...prev,
          [data.exchange]: data,
        }
      })
    })
    return () => {
      unsubscribe()
    }
  }, [subscribe, exchange, fromAmount, setSymbol])

  useEffect(() => {
    if (!exchange || !markets[exchange] || !fromAmount || !exchange) {
      return
    }
    setToAmount(new BigNumber(fromAmount).div(markets[exchange].price).toNumber())
  }, [markets, exchange, setToAmount, fromAmount])

  console.log('toAddress', toAddress, balances)

  useEffect(() => {
    if (exchange) {
      return
    }
    if (!debouncedFromAmount) {
      setToAmount(undefined);
      return;
    }
    const loadPrice = async () => {
      if (!debouncedFromAmount || !toAddress) {
        return;
      }
      const params = new URLSearchParams({
        address: toAddress,
        amount: String(debouncedFromAmount),
      })
      if (fromAddress) {
        params.set('addressFrom', fromAddress)
      }
      if (publicKey) {
        params.set('walletAddress', publicKey.toString())
      }
      const ref = query.get('ref');
      if (ref) {
        params.set('ref', ref)
      }
      const res = await fetch(`https://api.cryptoscan.pro/swap?${params}`)
      const data = await res.json();
      const price = data.price;
      setToAmount(new BigNumber(debouncedFromAmount).div(price).toNumber());
      setSwapTxn(data.transaction);
      setRequestId(data.requestId);
    }
    loadPrice();
    const interval = setInterval(loadPrice, 5000)
    return () => {
      clearInterval(interval);
    }
  }, [publicKey, debouncedFromAmount, fromAddress, setToAmount, exchange, toAddress, query])

  useEffect(() => {
    if (!publicKey) {
      return
    }
    getBalances(publicKey.toString()).then(setBalances)
    const interval = setInterval(() => getBalances(publicKey.toString()).then(setBalances), 60_000)
    return () => {
      clearInterval(interval);
    }
  }, [publicKey, swapTxn])

  const sortedMarkets = useMemo(() => {
    return Object.fromEntries(
      Object.entries(markets).sort((a, b) => {
        if (!dexExchange) {
          return 1;
        }
        const exchangePrice = markets[dexExchange].price;
        if (!exchangePrice) {
          return 1;
        }
        const aSpread = new BigNumber(exchangePrice).div(a[1].price).multipliedBy(100).minus(100).toNumber();
        const bSpread = new BigNumber(exchangePrice).div(b[1].price).multipliedBy(100).minus(100).toNumber();
        return Math.abs(bSpread) - Math.abs(aSpread);
      })
    )
  }, [markets, dexExchange])

  const handleTradeClick = async () => {
    if (!swapTxn || !publicKey || !requestId) return;

    try {
      const txnBuffer = Buffer.from(swapTxn, "base64");
      const transaction = VersionedTransaction.deserialize(txnBuffer);
      const signedTransaction = await signTransaction!(transaction);


      const request = fetch("https://api.cryptoscan.pro/swap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          txn: Buffer.from(signedTransaction.serialize()).toString("base64"),
          requestId,
        }),
      });
      toast.promise(request, {
        loading: 'Loading...',
        success: () => {
          return `Swap Successful`;
        },
        error: 'Swap Failed',
      });
      const response = await request;

      const result = await response.json();
      getBalances(publicKey.toString()).then(setBalances)
      console.log("Swap submitted:", result);
    } catch (error) {
      console.error("Swap failed:", error);
    }
  }

  return (
    <Suspense fallback={<div>Loading...</div>}>
      <div className="flex flex-wrap gap-5 md:gap-3 flex-row lg:flex-col justify-between md:justify-initial ">
        <div className="lg:min-w-full sm:min-w-70 min-w-full relative flex flex-col gap-2 bg-background rounded rounded-md p-2 border">
          <div className="flex items-center gap-1 select-none cursor-pointer hover:bg-muted/50 border rounded-lg py-1 px-2 w-max text-xs font-semibold text-foreground/80">
            <div className="flex items-center gap-1">
              <SettingsIcon size={12} />
              Manual
            </div>
            <Separator
              orientation="vertical"
              className="mx-1 data-[orientation=vertical]:h-3"
            />
            <div className="flex items-center gap-1">
              <ActivityIcon size={12} />
              0.5%
            </div>
            <SlidersHorizontalIcon className="ml-1" size={12} />
          </div>
          <div className="h-23 relative px-3 py-3 bg-muted/40 rounded-md w-full border">
            <div className="flex justify-between">
              <div className="text-muted-foreground text-xs">Selling</div>
              <div className="flex gap-1">
                {!!fromSymbol && (
                  <div className="flex gap-1 mr-1 text-xs items-center text-muted-foreground/50">
                    <WalletIcon size={10} />
                    {getBigNumber(fromBalance)} {fromSymbol.length > 5 ? fromSymbol.slice(0, 5) + '...' : fromSymbol}
                  </div>
                )}
                <Button
                  variant="secondary"
                  className="cursor-pointer text-muted-foreground text-xs rounded-sm block h-5 py-0 m-0 px-2"
                  onClick={() => setFromAmount(Number(getPrice(fromBalance / 2)))}
                >
                  HALF
                </Button>
                <Button
                  variant="secondary"
                  className="cursor-pointer text-muted-foreground text-xs rounded-sm block h-5 py-0 m-0 px-2"
                  onClick={() => setFromAmount(Number(getPrice(fromBalance)))}
                >
                  MAX
                </Button>
              </div>
            </div>
            <div className="w-full flex justify-between">
              <CommandSearch
                onClick={(coin) => {
                  setFromAddress(coin.id);
                  setFromSymbol(coin.symbol);
                }}
              >
                <div className="mt-2 h-max cursor-pointer select-none bg-muted hover:bg-muted/50 rounded w-max py-1 px-2 flex items-center gap-1 font-semibold text-sm">
                  <div>
                    {!!fromAddress && (
                      <CoinAvatar address={fromAddress!} width={15} height={15} />
                    )}
                  </div>
                  {fromSymbol}
                </div>
              </CommandSearch>
              <div className="relative bottom-1 h-max flex-1">
                <input
                  className="focus:outline-none text-right w-full border-none bg-transparent py-2 text-2xl font-bold"
                  placeholder="0.00"
                  onChange={(e) => {
                    setFromAmount(e.currentTarget.value ? Number(e.currentTarget.value) : undefined)
                  }}
                  value={fromAmount !== undefined ? String(fromAmount) : ''}
                />
              </div>
            </div>
            <div className="absolute right-3 bottom-2 text-muted-foreground text-[10px]">
              ${fromAmount ? fromAmount.toFixed() : '0'}
            </div>
          </div>

          <div className="-my-5 w-full flex items-center justify-center">
            <div
              className="w-8 h-8 flex items-center justify-center rounded-full border cursor-pointer text-muted-foreground hover:text-[#c8f284] border-3 border-background hover:border-[#c8f284] z-10 bg-muted"
              onClick={() => {
                setFromAddress(toAddress);
                setToAddress(fromAddress);
                setFromSymbol(ADDRESS_SYMBOLS[toAddress!] || symbol!);
                setToSymbol(ADDRESS_SYMBOLS[fromAddress!] || symbol!);
                setFromAmount(Number(getPrice(toAmount!)));
                setToAmount(Number(getPrice(fromAmount!)));
              }}
            >
              <ChangeIcon />
            </div>
          </div>

          <div className="h-23 relative px-3 py-3 bg-transparent rounded-md w-full border">
            <div className="flex justify-between">
              <div className="text-muted-foreground text-xs">Buying</div>
              <div className="flex gap-1">
                <div className="flex gap-1 mr-1 text-xs items-center text-muted-foreground/50">
                  <WalletIcon size={10} />
                  {getBigNumber(toBalance)} {toSymbol}
                </div>
              </div>
            </div>
            <div className="w-full flex justify-between">
              <CommandSearch
                onClick={(coin) => {
                  setToAddress(coin.id);
                  setToSymbol(coin.symbol);
                }}
              >
                <div className="mt-2 h-max cursor-pointer select-none bg-muted hover:bg-muted/50 rounded w-max py-1 px-2 flex items-center gap-1 font-semibold text-sm">
                  <div>
                    {!!toAddress && (
                      <CoinAvatar address={toAddress!} width={15} height={15} />
                    )}
                  </div>
                  {toSymbol}
                </div>
              </CommandSearch>
              <div className="relative bottom-1 h-max flex-1">
                <input
                  className="focus:outline-none text-right w-full border-none bg-transparent py-2 text-2xl font-bold"
                  placeholder="0.00"
                  onKeyPress={(e) => setToAmount(e.currentTarget.value ? Number(e.currentTarget.value) : undefined)}
                  value={toAmount ? getPrice(toAmount) : ''}
                />
              </div>
            </div>
            <div className="absolute right-3 bottom-2 text-muted-foreground text-[10px]">
              $0
            </div>
          </div>
          <div className="w-full mt-2">
            <Button
              className="w-full h-9 bg-[#80c116] dark:bg-[#c8f284] hover:bg-[#69991b] dark:hover:bg-[#a1c46e] cursor-pointer"
              disabled={!swapTxn}
              onClick={handleTradeClick}
            >
              Trade
            </Button>
          </div>
        </div>
        <div className="min-w-50 flex flex-1 flex-col gap-2 my-0 lg:my-0 overflow-scroll max-h-80 lg:border-none border lg:p-0 p-3 rounded lg:max-h-full w-full">
          {Object.values(sortedMarkets).map((market) => (
            <div
              key={market.exchange}
              className={
                cn(
                  "select-none cursor-pointer hover:bg-muted flex items-center justify-between gap-1 bg-input/30 px-3 py-1 rounded border",
                  market.exchange === exchange ? ' border-[#a1c46e]' : ''
                )
              }
              onClick={() => {
                setExchange(market.exchange !== exchange ? market.exchange : undefined)
                if (fromAmount && exchange) {
                  setToAmount(new BigNumber(fromAmount).div(markets[market.exchange]?.price).toNumber())
                }
              }}
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1">
                  <div className="text-xs font-semibold flex gap-1 items-center">
                    <span>1</span>
                    <CoinAvatar
                      className="border rounded-full inline-flex items-center justify-center w-6 h-6 text-[10px]"
                      address={fromAddress || fromSymbol!} width={15} height={15}
                    />
                    <span>≈</span>
                    <span>{getPrice(1 / market.price)}</span>
                    <CoinAvatar
                      className="border rounded-full inline-flex items-center justify-center w-6 h-6 text-[10px]"
                      address={market?.address || market.symbol!} width={15} height={15}
                    />
                  </div>
                </div>
                <div>
                  <div className="text-xs font-bold flex gap-1 items-center">
                    ${getPrice(market.price, true)}
                    {' '}
                    {dexExchange && !!markets[dexExchange] && (
                      <span className="font-medium text-muted-foreground">
                        ({new BigNumber(markets[market.exchange].price).div(markets[dexExchange].price).multipliedBy(100).minus(100).toFixed(1)}%)
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1 items-end">
                <div className="overflow-x-scroll no-scrollbar whitespace-nowrap max-w-20 flex items-center gap-1 bg-background rounded-lg border text-[11px] w-max px-2 py-1 font-semibold text-foreground/80 relative left-2">
                  <Avatar className="inline-flex items-center justify-center w-3 h-3 text-[10px] mr-1">
                    <AvatarImage src={`/${market.exchange}.png`} />
                    <AvatarFallback>{market.exchange.slice(0, 2)}</AvatarFallback>
                  </Avatar>
                  {market.exchange}
                </div>
                <div className="text-xs font-bold flex gap-1 items-center text-[#69991b] dark:text-[#c8f284]">
                  0% FEE
                </div>
              </div>
            </div>
          ))}
        </div>
      </div >
    </Suspense>
  )
}
