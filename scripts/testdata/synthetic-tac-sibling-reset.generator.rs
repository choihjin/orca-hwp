//! 관계형 — 글자 취급 표·도형 여럿이 한 문단에서 줄마다 놓이고 저장 사다리가 문단 중간에서
//! vpos 를 0 으로 되감을 때, 되감은 줄의 컨트롤만 새 쪽에서 시작한다.
//! 주석 갱신: 2026-11-20 (새 파일)
//!
//! 입력: `saved/blank2010.hwp` 의 구역에 합성 문단 하나를 넣는다(비공개 실문서의 형상을 숫자만
//! 옮김). 글자 없는 문단에 1×1 글자 취급 표 N 개가 각자 저장 줄 하나를 갖고, vpos 는 표 높이만큼
//! 쌓이다가 본문 높이를 넘기 직전 줄에서 0 으로 되감긴다.
//! - 표만 있는 문단: 수정 전에는 되감은 줄과 높이가 같은 형제 표가 모두 쪽 리셋 줄의 표로 읽혀
//!   (`needs_stored_line_advance` 의 높이 비교) 표마다 새 쪽을 열었다.
//! - 도형이 끼인 문단: 표 줄을 앞 표 개수로 세면 도형 줄만큼 어긋나 다른 줄의 vpos 0 을 이 표의
//!   리셋으로 읽었다. 한 줄에 도형 둘이 놓이면 도형마다 줄을 따로 쌓았다.
//! 기대: 되감은 줄 앞의 컨트롤은 첫 쪽, 되감은 줄부터는 둘째 쪽. 전체 2쪽.
#![cfg(not(target_arch = "wasm32"))]
#![allow(dead_code)]

use std::path::Path;

use rhwp::document_core::DocumentCore;
use rhwp::model::control::Control;
use rhwp::model::paragraph::{LineSeg, Paragraph};
use rhwp::model::shape::{CommonObjAttr, RectangleShape, ShapeObject, TextWrap};
use rhwp::model::table::{Cell, Table};
use rhwp::renderer::render_tree::{RenderNode, RenderNodeType};

const BLANK: &str = "saved/blank2010.hwp";
/// 줄 하나 = 표 하나의 높이 (HWPUNIT, 1×6 행 표 37.8px 와 같은 값).
const ROW_HU: i32 = 2835;
const BOX_HU: i32 = 1417;

fn blank() -> DocumentCore {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(BLANK);
    let bytes = std::fs::read(&path).unwrap_or_else(|e| panic!("read {BLANK}: {e}"));
    DocumentCore::from_bytes(&bytes).expect("open")
}

fn tac_table(width: i32, height: i32) -> Control {
    let mut table = Table {
        attr: 0x01,
        row_count: 1,
        col_count: 1,
        cells: vec![Cell::new_empty(0, 0, width as u32, height as u32, 1)],
        ..Default::default()
    };
    table.common.treat_as_char = true;
    table.common.text_wrap = TextWrap::InFrontOfText;
    table.common.width = width as u32;
    table.common.height = height as u32;
    table.rebuild_grid();
    Control::Table(Box::new(table))
}

fn tac_box(width: i32, height: i32) -> Control {
    Control::Shape(Box::new(ShapeObject::Rectangle(RectangleShape {
        common: CommonObjAttr {
            width: width as u32,
            height: height as u32,
            treat_as_char: true,
            text_wrap: TextWrap::InFrontOfText,
            ..Default::default()
        },
        ..Default::default()
    })))
}

/// `lines[i]` = i 번째 저장 줄의 컨트롤들. 줄 높이는 그 줄 컨트롤의 최대 높이.
/// `reset` 줄에서 vpos 를 0 으로 되감는다.
fn carrier(template: &Paragraph, width: i32, lines: &[Vec<Control>], reset: usize) -> Paragraph {
    let mut para = template.clone();
    para.text.clear();
    para.char_offsets.clear();
    para.controls.clear();
    para.line_segs.clear();
    let mut vpos = 0;
    for (index, line) in lines.iter().enumerate() {
        let height = line
            .iter()
            .map(|control| match control {
                Control::Table(table) => table.common.height as i32,
                Control::Shape(shape) => shape.common().height as i32,
                _ => 0,
            })
            .max()
            .unwrap();
        if index == reset {
            vpos = 0;
        }
        para.line_segs.push(LineSeg {
            text_start: (para.controls.len() * 8) as u32,
            vertical_pos: vpos,
            line_height: height,
            text_height: height,
            baseline_distance: height * 85 / 100,
            line_spacing: 0,
            segment_width: width,
            tag: 0x60000,
            ..Default::default()
        });
        vpos += height;
        para.controls.extend(line.iter().cloned());
    }
    para.char_count = (para.controls.len() * 8 + 1) as u32;
    para
}

fn body_height_hu(core: &DocumentCore) -> (i32, i32) {
    let page = &core.document().sections[0].section_def.page_def;
    let width = page.width as i32 - page.margin_left as i32 - page.margin_right as i32;
    let height = page.height as i32
        - page.margin_top as i32
        - page.margin_bottom as i32
        - page.margin_header as i32
        - page.margin_footer as i32;
    (width, height)
}

fn layout(lines: impl Fn(i32) -> (Vec<Vec<Control>>, usize)) -> (DocumentCore, usize) {
    let mut core = blank();
    let (width, body) = body_height_hu(&core);
    let (lines, reset) = lines(body);
    let mut document = core.document().clone();
    if std::env::var("SYNTH_OUT").is_ok() {
        eprintln!("SYNTH extra streams: {:?}", document.extra_streams.iter().map(|(p, d)| (p.clone(), d.len())).collect::<Vec<_>>());
        // 원본 빈 문서의 작성자·임시 경로·미리보기를 남기지 않는다.
        document.extra_streams.retain(|(path, _)| !path.contains("HwpSummaryInformation") && !path.contains("_LinkDoc"));
        document.preview = None;
    }
    let section = &mut document.sections[0];
    // 합성 문서다. 원본 봉인까지 지워야 "이 세션의 편집"(session_edited)으로 보지 않고
    // 원본 HWP5 저장 조판 규칙을 그대로 쓴다.
    section.raw_stream = None;
    section.raw_provenance = None;
    let template = section.paragraphs[0].clone();
    section.paragraphs = vec![carrier(&template, width, &lines, reset)];
    core.set_document(document);
    (core, reset)
}

fn find(node: &RenderNode, control: usize) -> bool {
    match &node.node_type {
        RenderNodeType::Table(table)
            if table.para_index == Some(0)
                && table.control_index == Some(control)
                && table.cell_context.is_none() =>
        {
            return true;
        }
        _ => {}
    }
    node.children.iter().any(|child| find(child, control))
}

fn page_of(core: &DocumentCore, control: usize) -> u32 {
    (0..core.page_count())
        .find(|&page| {
            find(
                &core.build_page_render_tree(page).expect("page").root,
                control,
            )
        })
        .unwrap_or_else(|| panic!("ci={control} 표가 어느 쪽에도 없다"))
}

/// 저장 줄 번호 → 그 줄 첫 컨트롤 번호.
fn first_control_of_line(lines: &[Vec<Control>], line: usize) -> usize {
    lines[..line].iter().map(Vec::len).sum()
}


fn table_lines(body: i32) -> (Vec<Vec<Control>>, usize) {
    let first_page = (body / ROW_HU - 1) as usize;
    let lines = (0..first_page + 5)
        .map(|_| vec![tac_table(20_000, ROW_HU)])
        .collect();
    (lines, first_page)
}

fn shape_lines(body: i32) -> (Vec<Vec<Control>>, usize) {
    let pattern = |index: usize| match index % 4 {
        0 | 2 => vec![tac_table(20_000, ROW_HU)],
        1 => vec![tac_box(20_000, BOX_HU)],
        _ => vec![tac_box(9_000, BOX_HU), tac_box(9_000, BOX_HU)],
    };
    let line_height = |index: usize| if index % 2 == 0 { ROW_HU } else { BOX_HU };
    let mut used = 0;
    let mut index = 0;
    while used + line_height(index) <= body {
        used += line_height(index);
        index += 1;
    }
    while index % 2 != 0 {
        index -= 1;
    }
    ((0..index + 8).map(pattern).collect(), index)
}

#[test]
fn write_synthetic_files() {
    let Ok(dir) = std::env::var("SYNTH_OUT") else { return };
    for (name, build) in [
        ("synthetic-tac-sibling-reset.hwp", table_lines as fn(i32) -> (Vec<Vec<Control>>, usize)),
        ("synthetic-tac-sibling-reset-shapes.hwp", shape_lines),
    ] {
        let (core, reset) = layout(build);
        let in_memory = core.page_count();
        let bytes = core.export_hwp_native().expect("export");
        std::fs::write(Path::new(&dir).join(name), &bytes).unwrap();
        let reloaded = DocumentCore::from_bytes(&bytes).expect("reload");
        eprintln!("SYNTH {name} reset_line={reset} pages_in_memory={in_memory} pages_reloaded={} bytes={}", reloaded.page_count(), bytes.len());
    }
}
