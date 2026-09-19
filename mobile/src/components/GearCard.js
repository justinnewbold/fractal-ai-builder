import { Image, Linking, ScrollView, Text, View } from 'react-native'

import { color, font, radius, space } from '../lib/theme'
import { photoFor } from '../lib/gearPhotos'
import { descriptionFor } from '../lib/lineage'
import { HOSTED_ORIGIN } from '../lib/pairing'
import Press from './Press'

/**
 * One model, on a page of its own.
 *
 * "Still not seeing any amp cab and pedal photos or descriptions. Should be
 * able to tap on the card and open a detailed page like this."
 *
 * The photographs and the descriptions were written and wired into one place
 * only — the panel inside the block editor, for the model already chosen,
 * which is the one model nobody is wondering about. The reference list, whose
 * whole purpose is "what have I got", was rows that could not be opened.
 *
 * Reading order, which is the order the questions come in: what the unit
 * calls it, what it really is, what it is like, what it looks like.
 *
 * WHERE THE PICTURE COMES FROM. Over the network, from the hosted site, and
 * not out of the app bundle. 55 photographs is 7MB and a finished roster
 * would be four times that — downloaded again by every phone on every
 * over-the-air update, for pictures somebody looks at twice. With no internet
 * this shows the words and no picture, which is what it does for three
 * quarters of the roster in any case.
 *
 * THE CREDIT IS PART OF THE PICTURE. Every one of these is Creative Commons
 * and naming the photographer is a condition of showing it at all, so there
 * is no arrangement of this screen that draws one without the other.
 */
export default function GearCard({ entry, onBack }) {
  if (!entry) return null
  const photo = photoFor(entry.name, `${HOSTED_ORIGIN}/gear`)
  const about = descriptionFor(entry.slug, entry.name)

  /* Two verbs, because one sentence will not carry both. "Based on Mesa" is
     not English — "based on" wants a thing. "Modelled on Mesa" reads correctly
     for every maker in the catalog, single word or not. */
  const lineage = entry.basedOn
    ? `Based on ${entry.basedOn}`
    : entry.manufacturer
      ? `Modelled on ${entry.manufacturer}`
      : entry.gear
        ? `Based on ${entry.gear}`
        : null

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: space.lg,
          gap: space.md
        }}
      >
        <Press label="‹ All models" height={40} onPress={onBack} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl, gap: space.md }}
      >
        <View>
          <Text
            accessibilityRole="header"
            style={{ color: color.silk, fontSize: font.title, fontWeight: '700' }}
          >
            {entry.name}
          </Text>
          {lineage ? (
            <Text style={{ color: color.ok, fontSize: font.body, marginTop: 2 }}>{lineage}</Text>
          ) : null}
        </View>

        {about ? (
          <Text style={{ color: color.silkDim, fontSize: font.body, lineHeight: 22 }}>{about}</Text>
        ) : null}

        {photo ? (
          <View style={{ gap: space.xs }}>
            <Image
              source={{ uri: photo.src }}
              accessibilityLabel={photo.alt}
              resizeMode="contain"
              style={{
                width: '100%',
                height: 200,
                borderRadius: radius.md,
                backgroundColor: color.panel
              }}
            />
            <Text
              onPress={() => Linking.openURL(photo.rights)}
              style={{ color: color.silkFaint, fontSize: font.micro }}
            >
              {photo.credit}
            </Text>
          </View>
        ) : null}

        {/*
          Said rather than left as a blank screen. Somebody who opens three
          models and gets three different amounts of page needs to know that
          is the state of the catalog rather than a fault in the app. The rule
          it obeys is the one lineage.js is built on: nothing invented,
          because a wrong attribution in a guitar app is worse than a blank.
        */}
        {!about && !photo ? (
          <Text style={{ color: color.silkFaint, fontSize: font.small, lineHeight: 20 }}>
            Nothing written down about this one yet. The catalog only
            holds what can be said for certain — a plausible guess would be read as fact by somebody
            who owns the real thing.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  )
}
