"use client";

import { useState } from "react";
import AccessTokenPanel from "./AccessTokenPanel";
import DocsSection from "./DocsSection";

interface Doc { id: number; name: string; content: string }

interface Props {
  docs: Doc[];
  fetchError: string | null;
}

export default function DocsPageClient({ docs, fetchError }: Props) {
  const [accessToken, setAccessToken] = useState<string | undefined>(undefined);

  return (
    <>
      <AccessTokenPanel onToken={setAccessToken} />
      <DocsSection docs={docs} fetchError={fetchError} accessToken={accessToken} />
    </>
  );
}
