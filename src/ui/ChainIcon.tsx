import type { SVGProps } from 'react'

/**
 * fomo's own chain identifiers, lifted verbatim from its bundle (the ChainIcon component and
 * its per-chain glyphs in the tradeSettings chunk, keys resolved against its chain
 * definitions). Each is a 20x20 rounded-square tile in bg-tertiary with the chain's glyph in
 * currentColor — except Ethereum, which fomo ships as a fixed-colour 24x24 tile. fomo has no
 * glyph for Hyperliquid and renders nothing there; so do we. The tile colour reads fomo's own
 * custom property, which inherits through the shadow boundary like the rest of the palette.
 */

type IconProps = SVGProps<SVGSVGElement>

const TILE = { width: 20, height: 20, rx: 3.33333, fill: 'var(--fobo-border-soft)' }

function SolanaIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" {...props}>
      <rect {...TILE} />
      <path
        d="M5.38047 12.5925C5.45709 12.5069 5.56245 12.457 5.67419 12.457H15.8076C15.9928 12.457 16.0854 12.7066 15.9545 12.8527L13.9527 15.0878C13.8761 15.1734 13.7707 15.2233 13.659 15.2233H3.52555C3.34037 15.2233 3.24779 14.9737 3.37869 14.8276L5.38047 12.5925Z"
        fill="currentColor"
      />
      <path
        d="M5.38047 4.24679C5.46029 4.16123 5.56564 4.11133 5.67419 4.11133H15.8076C15.9928 4.11133 16.0854 4.36086 15.9545 4.50701L13.9527 6.7421C13.8761 6.82766 13.7707 6.87756 13.659 6.87756H3.52555C3.34037 6.87756 3.24779 6.62803 3.37869 6.48188L5.38047 4.24679Z"
        fill="currentColor"
      />
      <path
        d="M13.9527 8.3923C13.8761 8.30674 13.7707 8.25684 13.659 8.25684H3.52555C3.34037 8.25684 3.24779 8.50637 3.37869 8.65252L5.38047 10.8876C5.45709 10.9732 5.56245 11.0231 5.67419 11.0231H15.8076C15.9928 11.0231 16.0854 10.7735 15.9545 10.6274L13.9527 8.3923Z"
        fill="currentColor"
      />
    </svg>
  )
}

function BaseIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" {...props}>
      <rect {...TILE} />
      <path
        d="M4.16611 5.08866C4.16611 4.77293 4.16611 4.61516 4.22562 4.49366C4.28259 4.37736 4.37656 4.28339 4.49286 4.22642C4.61427 4.16699 4.77204 4.16699 5.08777 4.16699H14.9111C15.2267 4.16699 15.3847 4.16699 15.5061 4.22651C15.6223 4.28348 15.7163 4.37745 15.7733 4.49375C15.8328 4.61516 15.8328 4.77302 15.8328 5.08875V14.9121C15.8328 15.2277 15.8328 15.3857 15.7733 15.5071C15.7163 15.6233 15.6223 15.7173 15.5061 15.7743C15.3847 15.8337 15.2267 15.8337 14.9111 15.8337H5.08777C4.77204 15.8337 4.61427 15.8337 4.49277 15.7743C4.37647 15.7173 4.2825 15.6233 4.22553 15.5071C4.16602 15.3857 4.16602 15.2277 4.16602 14.9121V5.08866H4.16611Z"
        fill="currentColor"
      />
    </svg>
  )
}

function BnbIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" {...props}>
      <rect {...TILE} />
      <path
        d="M6.01905 4.79756L9.99954 2.5L13.98 4.79756L12.5166 5.64634L9.99954 4.19756L7.48247 5.64634L6.01905 4.79756ZM13.98 7.69512L12.5166 6.84634L9.99954 8.29513L7.48247 6.84634L6.01905 7.69512V9.39269L8.53612 10.8414V13.739L9.99954 14.5878L11.463 13.739V10.8414L13.98 9.39269V7.69512ZM13.98 12.2902V10.5927L12.5166 11.4414V13.139L13.98 12.2902ZM15.019 12.8902L12.502 14.339V16.0366L16.4825 13.739V9.14388L15.019 9.99269V12.8902ZM13.5557 6.24634L15.019 7.09512V8.79269L16.4825 7.9439V6.24634L15.019 5.39756L13.5557 6.24634ZM8.53612 14.9537V16.6512L9.99954 17.5L11.463 16.6512V14.9537L9.99954 15.8024L8.53612 14.9537ZM6.01905 12.2902L7.48247 13.139V11.4414L6.01905 10.5927V12.2902ZM8.53612 6.24634L9.99954 7.09512L11.463 6.24634L9.99954 5.39756L8.53612 6.24634ZM4.98001 7.09512L6.44343 6.24634L4.98001 5.39756L3.5166 6.24634V7.9439L4.98001 8.79269V7.09512ZM4.98001 9.99269L3.5166 9.14388V13.739L7.49708 16.0366V14.339L4.98001 12.8902V9.99269Z"
        fill="currentColor"
      />
    </svg>
  )
}

function EthereumIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" {...props}>
      <rect width={24} height={24} rx={4} fill="#1A1A1A" />
      <path
        d="M11.9611 16.1458L6.84717 13.125L11.9604 20.3333L17.0784 13.125L11.959 16.1458H11.9611ZM12.0388 3.66667L6.92356 12.1549L12.0381 15.1785L17.1527 12.1576L12.0388 3.66667Z"
        fill="#9899A3"
      />
    </svg>
  )
}

function MonadIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" {...props}>
      <rect {...TILE} />
      <path
        d="M9.99957 2.5C7.86262 2.5 2.59961 7.83402 2.59961 9.99996C2.59961 12.1659 7.86262 17.5 9.99957 17.5C12.1365 17.5 17.3996 12.1658 17.3996 9.99996C17.3996 7.83411 12.1366 2.5 9.99957 2.5ZM8.84641 14.2887C7.94529 14.0398 5.52252 9.74451 5.76812 8.8312C6.01371 7.91785 10.2517 5.4624 11.1528 5.71131C12.0539 5.96019 14.4767 10.2554 14.2311 11.1688C13.9855 12.0821 9.74753 14.5376 8.84641 14.2887Z"
        fill="currentColor"
      />
    </svg>
  )
}

function RobinhoodIcon(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" {...props}>
      <rect {...TILE} />
      <path
        transform="translate(2.75 2.8) scale(0.6)"
        d="M2.84 24h.53c.096 0 .192-.048.224-.128C7.591 13.696 11.94 8.656 14.67 5.638c.112-.128.064-.225-.096-.225h-4.88a.55.55 0 0 0-.45.225L5.746 9.972c-.514.642-.642 1.236-.642 2.086v4.43c-1.14 3.194-1.862 5.361-2.392 7.32-.032.125.016.192.129.192M20.447.646c-.754-.802-4.157-.834-5.73-.224a3 3 0 0 0-.786.465 41 41 0 0 0-3.323 3.178c-.112.113-.064.225.097.225h5.409c.497 0 .786.289.786.786v6.1c0 .16.128.208.225.064l3.258-4.254c.53-.69.69-.898.835-1.861.192-1.413.08-3.58-.77-4.479m-6.982 16.18 2.231-3.676a.7.7 0 0 0 .064-.29V6.73c0-.16-.112-.225-.224-.097-3.355 3.74-5.971 7.672-8.395 12.407-.06.12.016.225.16.177l5.009-1.54c.565-.174.882-.402 1.155-.852"
        fill="currentColor"
      />
    </svg>
  )
}

const ICONS: Readonly<Record<number, (props: IconProps) => React.JSX.Element>> = {
  1399811149: SolanaIcon,
  8453: BaseIcon,
  56: BnbIcon,
  1: EthereumIcon,
  143: MonadIcon,
  4663: RobinhoodIcon,
}

/** fomo renders nothing for a chain it has no glyph for; a wrong badge is worse than none. */
export function ChainIcon({
  networkId,
  size = 16,
  className,
}: {
  networkId: number
  size?: number
  className?: string
}) {
  const Icon = ICONS[networkId]
  if (!Icon) return null
  return <Icon width={size} height={size} className={className} />
}
