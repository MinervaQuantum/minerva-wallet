import { View } from "react-native";

export interface Segment {
  /** 0..1 share of total. */
  value: number;
  color: string;
  label?: string;
}

interface Props {
  segments: Segment[];
  height?: number;
}

/** Source: Minerva Network — monochrome bar on mv-ink track.
 *  Segment colors should come from the mono palette (mv-bone / mv-mist / warn / crit). */
export function SegmentedBar({ segments, height = 8 }: Props) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <View
      style={{ height, borderRadius: height / 2, overflow: "hidden" }}
      className="flex-row bg-mv-ink"
    >
      {segments.map((s, i) => (
        <View key={i} style={{ flex: s.value / total, backgroundColor: s.color }} />
      ))}
    </View>
  );
}
