import { ReactNode } from "react";
import { View } from "react-native";

interface Props {
  children: ReactNode;
}

/** Source: Minerva Network — white-on-black framed QR. Thick 2px mv-bone border
 *  over mv-black, replacing the SWallet white frame on white. */
export function QrFrame({ children }: Props) {
  return (
    <View className="self-center p-5 rounded-xl border-2 border-mv-bone bg-mv-black">
      {children}
    </View>
  );
}
