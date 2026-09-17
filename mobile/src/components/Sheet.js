import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native'
import { BlurView } from 'expo-blur'

import { color, font, radius, space } from '../lib/theme'

/**
 * Something that comes up over the screen rather than into it.
 *
 * "When holding a block to change channel have it be an overlay on the screen
 * instead of inserting itself into the screen like the web version."
 *
 * WHY INSERTING IS WORSE THAN IT SOUNDS, and it is not only a matter of taste.
 * A panel that opens inside a scrolling page pushes everything below it down —
 * so the tiles a thumb was aimed at move while the thumb is on its way, and on
 * the one screen where that happens mid-song. The browser learned this and made
 * every one of these a sheet; the phone had the panel version of the same idea.
 *
 * A sheet comes up from the bottom because that is where a thumb is, and it
 * covers the page rather than resizing it, so nothing underneath moves at all.
 *
 * THE BACKDROP CLOSES IT AND THE PANEL DOES NOT. A press that lands on the sheet
 * is a press on the sheet, including one that started as a slip off a control.
 * Only the glass around it is a way out.
 */
export default function Sheet({ open, onClose, title, note, children }) {
  const { height } = useWindowDimensions()

  return (
    <Modal visible={!!open} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      {/* The glass, and the way out. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Close ${title || 'this'}`}
        onPress={onClose}
        style={{ flex: 1 }}
      >
        <BlurView
          intensity={60}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={{ flex: 1, justifyContent: 'flex-end' }}
        >
          <Pressable
            /* Swallows presses so the sheet does not close under the thing you
               are reaching for. */
            onPress={() => {}}
            style={{
              maxHeight: height * 0.8,
              backgroundColor: color.chassis,
              borderTopLeftRadius: radius.lg * 2,
              borderTopRightRadius: radius.lg * 2,
              borderTopWidth: 1,
              borderColor: 'rgba(255,255,255,0.14)',
              paddingBottom: space.xxl
            }}
          >
            {/* The grab handle. It does not drag — it says which way this came
                from and which way it goes, which is most of what it is for. */}
            <View style={{ alignItems: 'center', paddingTop: space.sm, paddingBottom: space.xs }}>
              <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: color.rule }} />
            </View>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: space.md,
                paddingHorizontal: space.lg,
                paddingVertical: space.md,
                borderBottomWidth: 1,
                borderBottomColor: color.rule
              }}
            >
              <View style={{ flexShrink: 1 }}>
                <Text
                  accessibilityRole="header"
                  numberOfLines={1}
                  style={{ color: color.silk, fontSize: font.title, fontWeight: '700' }}
                >
                  {title}
                </Text>
                {note ? (
                  <Text style={{ color: color.silkDim, fontSize: font.small }}>{note}</Text>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={onClose}
                style={({ pressed }) => ({
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pressed ? color.panelHi : color.panel
                })}
              >
                <Text style={{ color: color.silkDim, fontSize: font.lead }}>✕</Text>
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={{ padding: space.lg, gap: space.md }}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          </Pressable>
        </BlurView>
      </Pressable>
    </Modal>
  )
}
