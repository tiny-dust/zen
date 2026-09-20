import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { describe, expect, it } from "vitest";

import Attachment from "./Attachment.vue";
import AttachmentInfo from "./AttachmentInfo.vue";
import AttachmentPreview from "./AttachmentPreview.vue";
import Attachments from "./Attachments.vue";

const Harness = defineComponent({
  components: { Attachment, AttachmentInfo, AttachmentPreview, Attachments },
  props: { image: Boolean },
  template: `<Attachments variant="inline"><Attachment :data="{
    id: 'file', type: 'file', filename: image ? 'photo.png' : 'main.ts',
    path: '/tmp/original', url: image ? 'data:image/png;base64,AA==' : '',
    mediaType: image ? 'image/png' : 'text/plain'
  }"><AttachmentPreview /><AttachmentInfo /></Attachment></Attachments>`,
});

describe("file attachments", () => {
  it("shows one language icon with the original name and full path", () => {
    const wrapper = mount(Harness);
    expect(wrapper.text()).toBe("main.ts");
    expect(wrapper.findAll(".file-label img[data-file-icon]")).toHaveLength(1);
    expect(wrapper.get(".file-label img").attributes("data-file-icon")).toBe("typescript");
    expect(wrapper.get(".file-label").attributes("title")).toBe("/tmp/original");
    expect(wrapper.find(".border").exists()).toBe(false);
  });

  it("retains image previews alongside the file label", () => {
    const wrapper = mount(Harness, { props: { image: true } });
    expect(wrapper.get("img").attributes("src")).toBe("data:image/png;base64,AA==");
    expect(wrapper.text()).toBe("photo.png");
    expect(wrapper.find(".file-label img[data-file-icon]").exists()).toBe(true);
  });
});
