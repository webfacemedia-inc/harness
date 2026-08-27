// webfaCe Desk brand wordmark: the real webfaCeMEdia starburst mark (brand
// asset logo1.svg, brand blue #3499cc) beside the product name. Native 182x24.
// The mark keeps its brand colour in both themes; the name rides currentColor.

import type { IconProps } from './icons/props.ts'

/**
 * Render the full brand wordmark.
 * @param props.size - height in px (default 24; width keeps the 182:24 ratio).
 * @param props.className - extra class for layout placement.
 * @returns the wordmark svg (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className }: IconProps) {
  return (
    <svg
      width={(size * 182) / 24}
      height={size}
      className={className}
      viewBox="0 0 182 24"
      fill="none"
      aria-hidden="true"
    >
      <g transform="translate(0 0.5) scale(0.1292)">
        <path fill="#3499cc" d="M170.38,128.74l.45-.99.36-.72v-.77l.09-.52-.2-.97-.29-.81-.49-.77-.45-.67-46.66-64.72-.23-.36,37.44-22.82.95-2.83-.29-.45-.14-.22v-.14l-.65-.77-.58-.83-.68-.74-.45-.52-.32-.38-.81-.9-.31-.29-.14-.16h0l-.43-.43-.99-.9-2.31-2.56-2.31-2.23-2.54-2.16-2.54-2.11-.9-.67-.9-.45-.9-.29h-1.78l-.92.22-.9.38-.74.67-52.22,33.35-1.33-.38,19.02-40.59-.4-2.7-1.53-1.04-1.66-.81-1.93-.83-2-.67-2.32-.68-2.38-.52-2.61-.52-2.76-.38-1.71-.07-.74.23-.67.36-.67.38-.52.67-.45.88-.38.97-.14.45-34.02,80.01-.38.31-.36.43-.52.31-.67.43-36.48-18.08-2.9.38-.43.68-.27.88-.76,1.94-.88,2.32-.79,2.79-.95,3.6-.83,3.37-.65,3.06-.4,2.92-.14,1.01v.95l.22.9.4.9.43.68.76.61.79.61.97.5.16.09.67.36,1.04.52,1.57.83,1.8.97,2.45,1.26,2.76,1.42,3.26,1.8,1.8.83,1.8.97,1.93.95,2.16,1.13,4.47,2.32,4.99,2.61,5.28,2.77,2.83,1.4,3.06,1.58,6.18,3.21,6.77,3.6.14,1.49-44.26,3.71-2.11,1.8-.13,1.64v1.8l.23,2.03.36,2.16.54,2.16.74,2.47.83,2.54,1.1,2.77.31.74.52.67.5.54.77.36.67.23.88.16h2.09l78.41-10.5,2.81,1.49.74,33.19.97.97.99,1.35.58-.09h.81l.9-.16,1.12-.14,1.12-.31,1.33-.31,1.42-.36,1.57-.31,3.6-1.04,1.8-.45,1.62-.45,1.51-.52,1.4-.43,2.67-.9.97-.61.38-.29.43-.22.31-.38.38-.31.29-.36.31-.31.14-.45v-.22h0l.14-.16v-.45l.14-.38v-1.93l-2.72-62.11,1.19-.97,25.34,36.63,2.59,1.13,1.26-.85,1.51-.95,1.46-1.28,1.66-1.35,1.64-1.64,1.8-1.8,1.8-2.09,2.02-2.18.14-.22.11.02Z"/>
      </g>
      <text
        x="30"
        y="17.5"
        fontFamily="Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
        fontSize="15"
        fontWeight="700"
        letterSpacing="-0.2"
        fill="currentColor"
      >
        webfaCe <tspan fontWeight="500">Desk</tspan>
      </text>
    </svg>
  )
}
