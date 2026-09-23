import { Text, View } from 'react-native'

import { color, font, radius, space } from '../lib/theme'

/**
 * A few labelled facts, one to a line — the answers on Justin's own tools
 * (Customer lookup, Sales at a glance). The words come from lib/admin.js; this
 * only lays them out. `title` heads the group when there is one.
 */
export default function Facts({ title, rows }) {
  if (!rows?.length) return null
  return (
    <View style={{ gap: space.xs }}>
      {title ? (
        <Text style={{ color: color.silkDim, fontSize: font.micro, letterSpacing: 1, textTransform: 'uppercase' }}>{title}</Text>
      ) : null}
      <View style={{ borderRadius: radius.md, backgroundColor: color.panel, paddingHorizontal: space.md }}>
        {rows.map((row, i) => (
          <View
            key={`${row.label}-${i}`}
            style={{
              flexDirection: 'row',
              gap: space.md,
              paddingVertical: space.sm,
              borderTopWidth: i ? 1 : 0,
              borderTopColor: color.rule
            }}
          >
            {row.label ? (
              <Text style={{ width: 120, color: color.silkDim, fontSize: font.small, lineHeight: font.small * 1.4 }}>{row.label}</Text>
            ) : null}
            <Text style={{ flex: 1, color: color.silk, fontSize: font.small, lineHeight: font.small * 1.4 }}>{row.value}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}
