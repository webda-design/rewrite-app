import Head from "next/head";
import "../styles/globals.css";

export default function App({ Component, pageProps }) {
  return (
    <>
      <Head>
        <meta name="robots" content="noindex, nofollow" />
        <title>リライトAPP | ストレンジブレイン</title>
      </Head>
      <Component {...pageProps} />
    </>
  );
}
