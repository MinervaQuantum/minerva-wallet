import type { ReactNode } from "react";
import { Modal, Pressable, View } from "react-native";

interface Props {
  visible: boolean;
  onDismiss: () => void;
  children: ReactNode;
}

/** Source: Minerva Network — mv-ink sheet on a near-opaque mv-black backdrop,
 *  mv-line top hairline, mv-line-strong drag handle. */
export function Sheet({ visible, onDismiss, children }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable className="flex-1" style={{ backgroundColor: "rgba(5,5,5,0.7)" }} onPress={onDismiss}>
        <View className="flex-1" />
      </Pressable>
      <View className="bg-mv-ink rounded-t-xl border-t border-mv-line px-page pt-2 pb-8">
        <View className="self-center w-12 h-1.5 rounded-pill bg-mv-line-strong mb-4" />
        {children}
      </View>
    </Modal>
  );
}
